import type { HttpClient } from '../core/http';
import type { ExecuteWorkflowResult, Execution, Workflow } from '../types';
import type { WorkflowDefinition, WorkflowStepDefinition } from '../define';
import { resolveActionAppId, resolveActionId } from '../define';
import { serializeListQuery, type ListQueryOptions } from './common';
import type {
  ExecutionsResource,
  WaitUntilFinishedOptions,
} from './executions';

export interface UpsertWorkflowStepInput {
  appId: string;
  actionId: string;
  connectionId?: string;
  input?: Record<string, unknown>;
  name?: string;
  description?: string;
}

export interface UpsertWorkflowBySlugInput {
  slug: string;
  name?: string;
  description?: string;
  isActive?: boolean;
  steps: UpsertWorkflowStepInput[];
  managedByCode?: boolean;
}

function stepToUpsertInput(
  step: WorkflowStepDefinition,
): UpsertWorkflowStepInput {
  const use = step.use;
  return {
    appId: resolveActionAppId(use),
    actionId: resolveActionId(use),
    connectionId: use.connection?.id,
    input: {
      ...(use.input ?? {}),
      ...(step.input ?? {}),
    },
    name: step.name ?? use.name,
    description: use.description,
  };
}

export function workflowDefinitionToUpsert(
  def: WorkflowDefinition,
): UpsertWorkflowBySlugInput {
  return {
    slug: def.slug,
    name: def.name,
    description: def.description,
    isActive: def.isActive,
    managedByCode: true,
    steps: def.steps.map(stepToUpsertInput),
  };
}

export class WorkflowsResource {
  constructor(
    private readonly http: HttpClient,
    private readonly executions: ExecutionsResource,
  ) {}

  /** Lists workflows in the current workspace. */
  list(options?: ListQueryOptions): Promise<Workflow[]> {
    return this.http.get<Workflow[]>('/api/workflows', {
      query: serializeListQuery(options),
    });
  }

  /**
   * Returns a single workflow. Request `expansion: ['triggerNode']` to read
   * the manual trigger's custom input field definitions.
   */
  get(
    workflowId: string,
    options?: Pick<ListQueryOptions, 'expansion'>,
  ): Promise<Workflow> {
    return this.http.get<Workflow>(`/api/workflows/${workflowId}`, {
      query: serializeListQuery(options),
    });
  }

  /**
   * Upsert a workflow by project-scoped slug from a linear step list.
   * Prefer the CLI (`npx @lunnoa/client workflows deploy`) for happy-path deploy.
   */
  upsertBySlug(
    projectId: string,
    body: UpsertWorkflowBySlugInput | WorkflowDefinition,
  ): Promise<Workflow> {
    const payload =
      'kind' in body && body.kind === 'workflow'
        ? workflowDefinitionToUpsert(body)
        : body;
    return this.http.post<Workflow>(
      `/api/projects/${projectId}/workflows/upsert`,
      { body: payload },
    );
  }

  /**
   * Starts a new execution of the workflow with the given trigger inputs.
   * Returns immediately with the execution ID.
   */
  execute(
    workflowId: string,
    inputs?: Record<string, unknown>,
  ): Promise<ExecuteWorkflowResult> {
    return this.executions.execute(workflowId, inputs);
  }

  /**
   * Convenience: execute the workflow and wait (poll with backoff) until it
   * reaches a terminal status or pauses in `NEEDS_INPUT`.
   */
  async executeAndWait(
    workflowId: string,
    inputs?: Record<string, unknown>,
    waitOptions?: WaitUntilFinishedOptions,
  ): Promise<Execution> {
    const { id } = await this.executions.execute(workflowId, inputs);
    return this.executions.waitUntilFinished(id, waitOptions);
  }

  /**
   * Triggers a workflow through its unauthenticated custom webhook endpoint
   * (`POST /api/webhooks/workflows/:workflowId`). Only works for workflows
   * with a webhook trigger. Returns the synchronous trigger output when the
   * workflow responds synchronously.
   */
  triggerWebhook(
    workflowId: string,
    payload?: Record<string, unknown>,
  ): Promise<Record<string, unknown> | undefined> {
    return this.http.post<Record<string, unknown> | undefined>(
      `/api/webhooks/workflows/${workflowId}`,
      { body: payload ?? {} },
    );
  }
}
