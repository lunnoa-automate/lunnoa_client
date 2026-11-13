import type { HttpClient } from '../core/http';
import type {
  CodeDefinitionResponse,
  CodeSource,
  ExecuteWorkflowResult,
  Execution,
  Workflow,
} from '../types';
import type {
  ActionDefinition,
  TriggerDefinition,
  WorkflowDefinition,
  WorkflowFileDefinition,
  WorkflowGraphFileDefinition,
  WorkflowPathDefinition,
  WorkflowStepDefinition,
  WorkflowStepFile,
  WorkflowStepsFileDefinition,
  WorkflowTriggerFile,
} from '../define';
import {
  DEFINE_KINDS,
  resolveActionAppId,
  resolveActionId,
  resolveTriggerAppId,
  resolveTriggerId,
} from '../define';
import { serializeListQuery, type ListQueryOptions } from './common';
import type {
  ExecutionsResource,
  WaitUntilFinishedOptions,
} from './executions';

export interface UpsertWorkflowStepInput {
  /** Name later steps use in `={{step:<key>,path}}`. Keeps the node id stable. */
  key?: string;
  appId: string;
  actionId: string;
  connectionId?: string;
  input?: Record<string, unknown>;
  name?: string;
  description?: string;
  retrySettings?: {
    enabled: boolean;
    maxAttempts: number;
    delaySeconds: number;
  };
  continueOnFailure?: { enabled: boolean };
  /** Branches after this step (last step of a list only). */
  paths?: UpsertWorkflowPathInput[];
}

export interface UpsertWorkflowPathInput {
  label: string;
  when?: WorkflowPathDefinition['when'];
  steps: UpsertWorkflowStepInput[];
}

export interface UpsertWorkflowTriggerInput {
  triggerId: string;
  appId?: string;
  connectionId?: string;
  /** Catalogue trigger config. */
  input?: Record<string, unknown>;
  /** Manual-trigger fields. Stored as `customInputConfig`. */
  inputs?: TriggerDefinition['inputs'];
  name?: string;
  description?: string;
}

export interface UpsertWorkflowGraphInput {
  nodes: WorkflowGraphFileDefinition['nodes'];
  edges: WorkflowGraphFileDefinition['edges'];
}

export interface UpsertWorkflowBySlugInput {
  slug: string;
  name?: string;
  /** Null clears a description that was removed from the definition file. */
  description?: string | null;
  isActive?: boolean;
  /** Omit for Manually Run with no input fields. */
  trigger?: UpsertWorkflowTriggerInput;
  steps?: UpsertWorkflowStepInput[];
  /** Lossless graph. Not sent together with `trigger` / `steps`. */
  graph?: UpsertWorkflowGraphInput;
  /** `generated` for TypeScript deploys, `synced` for definition files. */
  codeSource?: Extract<CodeSource, 'synced' | 'generated'>;
  baseRevision?: string;
  force?: boolean;
}

export interface WorkflowUpsertOptions {
  codeSource?: Extract<CodeSource, 'synced' | 'generated'>;
  baseRevision?: string;
  force?: boolean;
}

function triggerToUpsertInput(
  trigger: TriggerDefinition,
): UpsertWorkflowTriggerInput {
  return {
    triggerId: resolveTriggerId(trigger),
    appId: resolveTriggerAppId(trigger),
    ...(trigger.connection?.id ? { connectionId: trigger.connection.id } : {}),
    ...(trigger.input ? { input: trigger.input } : {}),
    ...(trigger.inputs?.length ? { inputs: trigger.inputs } : {}),
    ...(trigger.name ? { name: trigger.name } : {}),
    ...(trigger.description ? { description: trigger.description } : {}),
  };
}

function asAction(use: ActionDefinition | WorkflowStepFile['use']): ActionDefinition {
  if (use && typeof use === 'object' && 'kind' in use && use.kind === DEFINE_KINDS.action) {
    return use;
  }
  const fileUse = use as WorkflowStepFile['use'];
  return {
    kind: DEFINE_KINDS.action,
    id: fileUse.id,
    appId: fileUse.appId,
    connection: fileUse.connection?.id
      ? { kind: DEFINE_KINDS.connection, id: fileUse.connection.id }
      : undefined,
  };
}

function asTrigger(trigger: TriggerDefinition | WorkflowTriggerFile): TriggerDefinition {
  if ('kind' in trigger && trigger.kind === DEFINE_KINDS.trigger) {
    return trigger;
  }
  const fileTrigger = trigger as WorkflowTriggerFile;
  return {
    kind: DEFINE_KINDS.trigger,
    id: fileTrigger.id,
    appId: fileTrigger.appId,
    connection: fileTrigger.connection?.id
      ? { kind: DEFINE_KINDS.connection, id: fileTrigger.connection.id }
      : undefined,
    input: fileTrigger.input,
    inputs: fileTrigger.inputs as TriggerDefinition['inputs'],
    name: fileTrigger.name,
    description: fileTrigger.description,
  };
}

function stepToUpsertInput(
  step: WorkflowStepDefinition | WorkflowStepFile,
): UpsertWorkflowStepInput {
  const use = asAction(step.use);
  const retry = 'retrySettings' in step ? step.retrySettings : undefined;
  const continueOnFailure =
    'continueOnFailure' in step ? step.continueOnFailure : undefined;
  return {
    ...(step.key ? { key: step.key } : {}),
    appId: resolveActionAppId(use),
    actionId: resolveActionId(use),
    connectionId: use.connection?.id,
    input: {
      ...(use.input ?? {}),
      ...(step.input ?? {}),
    },
    name: step.name ?? use.name,
    description: step.description ?? use.description,
    ...(retry ? { retrySettings: retry } : {}),
    ...(continueOnFailure ? { continueOnFailure } : {}),
    ...(step.paths?.length
      ? {
          paths: step.paths.map((path) => ({
            label: path.label,
            ...(path.when
              ? { when: path.when as WorkflowPathDefinition['when'] }
              : {}),
            steps: path.steps.map((nested) =>
              stepToUpsertInput(nested as WorkflowStepDefinition | WorkflowStepFile),
            ),
          })),
        }
      : {}),
  };
}

function syncFields(
  options?: WorkflowUpsertOptions,
): Pick<UpsertWorkflowBySlugInput, 'baseRevision' | 'force'> {
  return {
    ...(options?.baseRevision ? { baseRevision: options.baseRevision } : {}),
    ...(options?.force ? { force: true } : {}),
  };
}

export function workflowDefinitionToUpsert(
  def: WorkflowDefinition,
  options?: WorkflowUpsertOptions,
): UpsertWorkflowBySlugInput & { steps: UpsertWorkflowStepInput[] };
export function workflowDefinitionToUpsert(
  def: WorkflowFileDefinition,
  options?: WorkflowUpsertOptions,
): UpsertWorkflowBySlugInput;
export function workflowDefinitionToUpsert(
  def: WorkflowDefinition | WorkflowFileDefinition,
  options?: WorkflowUpsertOptions,
): UpsertWorkflowBySlugInput;
export function workflowDefinitionToUpsert(
  def: WorkflowDefinition | WorkflowFileDefinition,
  options?: WorkflowUpsertOptions,
): UpsertWorkflowBySlugInput {
  if ('format' in def && def.format === 'graph') {
    return {
      slug: def.slug,
      name: def.name,
      // A file is the whole definition: an omitted description is empty, not "leave it".
      description: def.description ?? null,
      codeSource: 'synced',
      graph: { nodes: def.nodes, edges: def.edges ?? [] },
      ...syncFields(options),
    };
  }
  if ('format' in def && def.format === 'steps') {
    const file = def as WorkflowStepsFileDefinition;
    return {
      slug: file.slug,
      name: file.name,
      description: file.description ?? null,
      ...(file.trigger ? { trigger: triggerToUpsertInput(asTrigger(file.trigger)) } : {}),
      codeSource: 'synced',
      steps: file.steps.map((step) => stepToUpsertInput(step)),
      ...syncFields(options),
    };
  }
  const authored = def as WorkflowDefinition;
  return {
    slug: authored.slug,
    name: authored.name,
    description: authored.description,
    isActive: authored.isActive,
    ...(authored.trigger ? { trigger: triggerToUpsertInput(authored.trigger) } : {}),
    codeSource: options?.codeSource ?? 'generated',
    ...syncFields(options),
    steps: authored.steps.map((step) => stepToUpsertInput(step)),
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

  /** Exported definition for `lunnoa/workflows/<slug>.json`. */
  getDefinition(
    slug: string,
  ): Promise<CodeDefinitionResponse<WorkflowFileDefinition>> {
    return this.http.get<CodeDefinitionResponse<WorkflowFileDefinition>>(
      `/api/workflows/slug/${encodeURIComponent(slug)}/definition`,
    );
  }

  /**
   * Upsert a workflow by slug inside the workspace on the API key.
   * Prefer the CLI (`npx @lunnoa/client workflows deploy`) for happy-path deploy.
   */
  upsertBySlug(
    body: UpsertWorkflowBySlugInput | WorkflowDefinition | WorkflowFileDefinition,
    options?: WorkflowUpsertOptions,
  ): Promise<Workflow & CodeDefinitionResponse<WorkflowFileDefinition>> {
    const payload =
      'kind' in body && body.kind === 'workflow'
        ? workflowDefinitionToUpsert(body, options)
        : body;
    return this.http.post<Workflow & CodeDefinitionResponse<WorkflowFileDefinition>>(
      '/api/workflows/upsert',
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
