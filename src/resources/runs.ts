import type { HttpClient } from '../core/http';
import type {
  ActionDefinition,
  WorkflowDefinition,
  WorkflowStepDefinition,
} from '../define';
import {
  resolveActionAppId,
  resolveActionId,
} from '../define';
import type { Execution, RunActionResult } from '../types';
import type {
  ExecutionsResource,
  WaitUntilFinishedOptions,
} from './executions';

export interface StartRunStep {
  appId: string;
  actionId: string;
  connectionId?: string;
  input?: Record<string, unknown>;
  name?: string;
}

export interface StartRunOptions {
  steps: StartRunStep[];
  projectId?: string;
  name?: string;
}

export type StartRunInput =
  | StartRunOptions
  | WorkflowDefinition
  | WorkflowStepDefinition[]
  | StartRunStep[];

function isWorkflowDefinition(value: unknown): value is WorkflowDefinition {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as WorkflowDefinition).kind === 'workflow'
  );
}

function isActionDefinition(value: unknown): value is ActionDefinition {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as ActionDefinition).kind === 'action'
  );
}

function stepFromDefinition(
  step: WorkflowStepDefinition | StartRunStep | ActionDefinition,
): StartRunStep {
  if ('appId' in step && 'actionId' in step && !('use' in step) && !('kind' in step)) {
    return step as StartRunStep;
  }
  if (isActionDefinition(step)) {
    return {
      appId: resolveActionAppId(step),
      actionId: resolveActionId(step),
      ...(step.connection?.id ? { connectionId: step.connection.id } : {}),
      ...(step.input ? { input: step.input } : {}),
      ...(step.name ? { name: step.name } : {}),
    };
  }
  const use = (step as WorkflowStepDefinition).use;
  const input = {
    ...(use.input ?? {}),
    ...((step as WorkflowStepDefinition).input ?? {}),
  };
  return {
    appId: resolveActionAppId(use),
    actionId: resolveActionId(use),
    ...(use.connection?.id ? { connectionId: use.connection.id } : {}),
    ...(Object.keys(input).length ? { input } : {}),
    ...(((step as WorkflowStepDefinition).name ?? use.name)
      ? { name: (step as WorkflowStepDefinition).name ?? use.name }
      : {}),
  };
}

function normalizeStartRunInput(input: StartRunInput): StartRunOptions {
  if (isWorkflowDefinition(input)) {
    return {
      steps: input.steps.map(stepFromDefinition),
      name: input.name ?? input.slug,
    };
  }
  if (Array.isArray(input)) {
    return { steps: input.map((s) => stepFromDefinition(s as any)) };
  }
  return input;
}

/**
 * Multi-step ad-hoc runs (`POST /api/runs`) → one Execution with `source: SDK`.
 */
export class RunsResource {
  constructor(
    private readonly http: HttpClient,
    private readonly executions: ExecutionsResource,
  ) {}

  /**
   * Start a linear multi-step ad-hoc Execution.
   *
   * Accepts a `defineWorkflow` result, a step array, or an explicit
   * `{ steps, projectId?, name? }` payload.
   */
  start(input: StartRunInput): Promise<RunActionResult> {
    const options = normalizeStartRunInput(input);
    if (!options.steps?.length) {
      throw new Error('runs.start requires at least one step');
    }
    return this.http.post<RunActionResult>('/api/runs', {
      body: options,
    });
  }

  /** Convenience: start and wait until terminal / NEEDS_INPUT. */
  async startAndWait(
    input: StartRunInput,
    waitOptions?: WaitUntilFinishedOptions,
  ): Promise<Execution> {
    const { id } = await this.start(input);
    return this.executions.waitUntilFinished(id, {
      ...waitOptions,
      expansion: [
        'executionPath',
        'source',
        ...(waitOptions?.expansion ?? []),
      ],
    });
  }
}
