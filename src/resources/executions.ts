import type { HttpClient } from '../core/http';
import type {
  ExecuteWorkflowResult,
  Execution,
  ExecutionStatus,
} from '../types';
import { serializeListQuery, type ListQueryOptions } from './common';

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

export class ExecutionsResource {
  constructor(private readonly http: HttpClient) {}

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
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
