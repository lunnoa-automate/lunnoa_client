import type { HttpClient } from '../core/http';
import type {
  ExecuteWorkflowResult,
  Execution,
  ExecutionPathStep,
  ExecutionStatus,
  WorkflowApp,
} from '../types';
import {
  openExecutionStream,
  type ExecutionProgressPayload,
  type ExecutionProgressStream,
  type WatchProgressOptions,
} from '../streaming/execution-progress';
import { serializeListQuery, type ListQueryOptions } from './common';
import type { WorkflowAppsResource } from './workflow-apps';

/** Execution statuses that end an execution. */
const TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  'SUCCESS',
  'FAILED',
  'CANCELLED',
]);

export interface WaitUntilFinishedOptions {
  /** Give up after this long. Default: 10 minutes. */
  timeoutMs?: number;
  /** First delay between polls. Default: 500ms. */
  initialDelayMs?: number;
  /** Cap on the delay between polls. Default: 5s. */
  maxDelayMs?: number;
  /** Multiplier applied to the delay after each poll. Default: 1.5. */
  backoffFactor?: number;
  /**
   * Also stop waiting when the execution pauses in `NEEDS_INPUT` (so a form
   * can be shown). Default: true.
   */
  stopOnNeedsInput?: boolean;
  /** Extra expansion fields to request with each poll (always includes `status,statusMessage,output`). */
  expansion?: string[];
  signal?: AbortSignal;
  /** Injectable sleep, for tests. */
  sleep?: (ms: number) => Promise<void>;
}

export class ExecutionTimeoutError extends Error {
  constructor(
    readonly executionId: string,
    readonly timeoutMs: number,
  ) {
    super(
      `Execution ${executionId} did not finish within ${timeoutMs}ms. It is still running server-side; keep polling executions.get() or increase timeoutMs.`,
    );
    this.name = 'ExecutionTimeoutError';
  }
}

/** One step in a timeline-ready progress snapshot. */
export interface ExecutionProgressStep extends ExecutionPathStep {
  /** App logo URL from the workflow-apps catalogue, when resolvable. */
  appLogoUrl?: string | null;
  /** Action/trigger icon URL from the catalogue, when resolvable. */
  iconUrl?: string | null;
  /** Duration in ms when both startTime and endTime are present. */
  durationMs?: number | null;
}

/** Timeline-ready progress for a custom UI (status bar / step list). */
export interface ExecutionProgress {
  executionId: string;
  status?: ExecutionStatus | string;
  statusMessage?: string | null;
  name?: string | null;
  source?: string | null;
  startedAt?: string;
  stoppedAt?: string | null;
  steps: ExecutionProgressStep[];
  pendingInput?: unknown;
  output?: unknown;
  /** Index of the first non-terminal step, or -1 when all done / unknown. */
  activeStepIndex: number;
}

export class ExecutionsResource {
  private catalogCache: WorkflowApp[] | null = null;

  constructor(
    private readonly http: HttpClient,
    private readonly workflowApps?: WorkflowAppsResource,
  ) {}

  /**
   * Starts a new execution of a workflow. Only the execution ID is returned;
   * use {@link waitUntilFinished} or `get` to track progress.
   */
  execute(
    workflowId: string,
    inputData?: Record<string, unknown>,
  ): Promise<ExecuteWorkflowResult> {
    return this.http.post<ExecuteWorkflowResult>(
      `/api/executions/workflows/${workflowId}/execute`,
      { body: { inputData: inputData ?? {} } },
    );
  }

  /** Lists executions in the current workspace, most recently started first. */
  list(options?: ListQueryOptions): Promise<Execution[]> {
    return this.http.get<Execution[]>('/api/executions', {
      query: serializeListQuery(options),
    });
  }

  /**
   * Returns a single execution. Request `expansion: ['status', 'executionPath']`
   * for the business-readable step list custom UIs render progress from.
   */
  get(
    executionId: string,
    options?: Pick<ListQueryOptions, 'expansion'>,
  ): Promise<Execution> {
    return this.http.get<Execution>(`/api/executions/${executionId}`, {
      query: serializeListQuery(options),
    });
  }

  /**
   * Timeline-ready progress: `executionPath` plus catalogue icons/logos.
   * Use this for a custom status bar / step list (not raw nodes/edges).
   */
  async getProgress(executionId: string): Promise<ExecutionProgress> {
    const execution = await this.get(executionId, {
      expansion: [
        'status',
        'statusMessage',
        'executionPath',
        'pendingInput',
        'source',
        'name',
        'startedAt',
        'stoppedAt',
        'output',
      ],
    });
    return this.#toProgress(execution);
  }

  /**
   * Opens the Public API SSE stream (`GET /executions/:id/stream`).
   * Yields `execution.progress`, `loop.progress`, `execution.finished`, etc.
   * For a simple timeline, prefer {@link watchProgress}.
   */
  stream(
    executionId: string,
    options?: WatchProgressOptions,
  ): Promise<ExecutionProgressStream> {
    return openExecutionStream(this.http, executionId, options);
  }

  /**
   * Live progress snapshots for a custom timeline UI.
   * Subscribes to SSE `execution.progress` events (and enriches steps with icons).
   * Completes when the execution reaches a terminal status or the signal aborts.
   */
  async *watchProgress(
    executionId: string,
    options?: WatchProgressOptions,
  ): AsyncGenerator<ExecutionProgress, void, undefined> {
    const stream = await this.stream(executionId, options);
    for await (const frame of stream) {
      if (frame.event === 'execution.progress') {
        const payload = frame.data as unknown as ExecutionProgressPayload;
        yield await this.#progressFromPayload(payload);
      } else if (frame.event === 'execution.finished') {
        // Ensure a final enriched snapshot even if the last progress was skipped.
        yield await this.getProgress(executionId);
        return;
      } else if (frame.event === 'execution.error') {
        throw new Error(
          typeof frame.data.message === 'string'
            ? frame.data.message
            : `Execution stream error for ${executionId}`,
        );
      }
    }
  }

  /**
   * Polls an execution with exponential backoff until it reaches a terminal
   * status (`SUCCESS`, `FAILED`, `CANCELLED`) — or pauses in `NEEDS_INPUT`
   * (unless `stopOnNeedsInput: false`). Resolves with the final execution
   * including `status`, `statusMessage`, and `output`.
   */
  async waitUntilFinished(
    executionId: string,
    options: WaitUntilFinishedOptions = {},
  ): Promise<Execution> {
    const {
      timeoutMs = 10 * 60 * 1000,
      initialDelayMs = 500,
      maxDelayMs = 5_000,
      backoffFactor = 1.5,
      stopOnNeedsInput = true,
      expansion = [],
      signal,
      sleep = defaultSleep,
    } = options;

    const pollExpansion = Array.from(
      new Set(['status', 'statusMessage', 'output', ...expansion]),
    );

    const startedAt = Date.now();
    // Accumulated requested sleep time; combined with wall-clock elapsed so the
    // budget holds both in real use and with an injected (instant) sleep.
    let waitedMs = 0;
    let delay = initialDelayMs;

    while (true) {
      signal?.throwIfAborted();

      const execution = await this.get(executionId, {
        expansion: pollExpansion,
      });
      const status = execution.status as ExecutionStatus | undefined;

      if (status && TERMINAL_STATUSES.has(status)) {
        return execution;
      }
      if (stopOnNeedsInput && status === 'NEEDS_INPUT') {
        return execution;
      }

      const elapsed = Math.max(Date.now() - startedAt, waitedMs);
      if (elapsed + delay > timeoutMs) {
        throw new ExecutionTimeoutError(executionId, timeoutMs);
      }

      await sleep(delay);
      waitedMs += delay;
      delay = Math.min(delay * backoffFactor, maxDelayMs);
    }
  }

  /**
   * Resumes an execution paused in `NEEDS_INPUT` by submitting values for the
   * waiting node. Identify the waiting node and its field schema via
   * `expansion: ['pendingInput', 'executionPath']` (prefer `pendingInput` for
   * the form contract; `executionPath` steps with status `NEEDS_INPUT` also
   * carry the `nodeId`). Required fields from the schema must be present.
   * The server acknowledges immediately and resumes asynchronously — follow
   * up with {@link waitUntilFinished}.
   */
  async submitInput(
    executionId: string,
    nodeId: string,
    values: Record<string, unknown>,
  ): Promise<void> {
    await this.http.post<unknown>(
      `/api/webhooks/executions/${executionId}/nodes/${nodeId}/input`,
      { body: values },
    );
  }

  /**
   * Submit an approve/reject decision for a Request Approval node.
   * Uses the authenticated Approvals API (not the public input webhook).
   * Partial approvals keep the execution paused; terminal decisions resume it.
   */
  async submitApproval(
    executionId: string,
    nodeId: string,
    body: {
      decision: 'approved' | 'rejected';
      comment?: string;
    },
  ): Promise<{
    executionId: string;
    nodeId: string;
    approvalId?: string;
    terminal: boolean;
    canDecide: boolean;
    approval: Record<string, unknown>;
  }> {
    return this.http.post(
      `/api/executions/${executionId}/nodes/${nodeId}/approvals`,
      { body },
    );
  }

  async #toProgress(execution: Execution): Promise<ExecutionProgress> {
    const path = (execution.executionPath ?? []) as ExecutionPathStep[];
    const steps = await this.#enrichSteps(path);
    return {
      executionId: execution.id,
      status: execution.status,
      statusMessage: execution.statusMessage ?? null,
      name: (execution as { name?: string | null }).name ?? null,
      source: (execution as { source?: string | null }).source ?? null,
      startedAt: execution.startedAt,
      stoppedAt: execution.stoppedAt ?? null,
      steps,
      pendingInput: (execution as { pendingInput?: unknown }).pendingInput,
      output: execution.output,
      activeStepIndex: findActiveStepIndex(steps),
    };
  }

  async #progressFromPayload(
    payload: ExecutionProgressPayload,
  ): Promise<ExecutionProgress> {
    const steps = await this.#enrichSteps(payload.executionPath ?? []);
    return {
      executionId: payload.executionId,
      status: payload.status ?? undefined,
      statusMessage: payload.statusMessage,
      name: payload.name,
      source: payload.source,
      startedAt: payload.startedAt,
      stoppedAt: payload.stoppedAt,
      steps,
      pendingInput: payload.pendingInput,
      output: payload.output,
      activeStepIndex: findActiveStepIndex(steps),
    };
  }

  async #enrichSteps(
    path: ExecutionPathStep[],
  ): Promise<ExecutionProgressStep[]> {
    const catalog = await this.#loadCatalog();
    return path.map((step) => {
      const app = catalog?.find((a) => a.id === step.appId);
      const action =
        step.actionId && Array.isArray(app?.actions)
          ? (app!.actions as Record<string, unknown>[]).find(
              (a) => a && typeof a === 'object' && a.id === step.actionId,
            )
          : undefined;
      const trigger =
        step.triggerId && Array.isArray(app?.triggers)
          ? (app!.triggers as Record<string, unknown>[]).find(
              (t) => t && typeof t === 'object' && t.id === step.triggerId,
            )
          : undefined;
      const iconUrl =
        (typeof action?.iconUrl === 'string' && action.iconUrl) ||
        (typeof trigger?.iconUrl === 'string' && trigger.iconUrl) ||
        null;
      const durationMs = computeDurationMs(step.startTime, step.endTime);
      return {
        ...step,
        appLogoUrl: app?.logoUrl ?? null,
        iconUrl,
        durationMs,
      };
    });
  }

  async #loadCatalog(): Promise<WorkflowApp[] | null> {
    if (!this.workflowApps) {
      return null;
    }
    if (!this.catalogCache) {
      try {
        this.catalogCache = await this.workflowApps.list();
      } catch {
        return null;
      }
    }
    return this.catalogCache;
  }
}

function findActiveStepIndex(steps: ExecutionProgressStep[]): number {
  const idx = steps.findIndex(
    (s) =>
      s.status === 'RUNNING' ||
      s.status === 'NEEDS_INPUT' ||
      s.status === 'RETRYING' ||
      s.status === 'WAITING' ||
      s.status === 'SCHEDULED',
  );
  return idx;
}

function computeDurationMs(
  start?: string,
  end?: string,
): number | null {
  if (!start || !end) return null;
  const a = Date.parse(start);
  const b = Date.parse(end);
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return null;
  return b - a;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
