/**
 * Pure typed definition factories for local workflow/agent authoring.
 * These do not call the network. Deploy with the CLI; run ad-hoc with `runs.start`.
 *
 * Not the same as `@lunnoa/toolkit` `createAction` / `createApp` (in-platform apps).
 */

export const DEFINE_KINDS = {
  connection: 'connection',
  aiConnection: 'aiConnection',
  action: 'action',
  trigger: 'trigger',
  workflow: 'workflow',
  agent: 'agent',
  entityType: 'entityType',
} as const;

export type DefineKind = (typeof DEFINE_KINDS)[keyof typeof DEFINE_KINDS];

/** Ref to an existing app Connection (credentials stay on Lunnoa). */
export interface ConnectionDefinition {
  kind: typeof DEFINE_KINDS.connection;
  /** Connection instance UUID. Optional when the platform can resolve sole/default. */
  id?: string;
}

/** Ref to an existing AiProviderConnection. */
export interface AiConnectionDefinition {
  kind: typeof DEFINE_KINDS.aiConnection;
  /** AiProviderConnection UUID. Optional when platform AI defaults apply. */
  id?: string;
}

export interface ActionDefinition {
  kind: typeof DEFINE_KINDS.action;
  /**
   * Catalogue action id, e.g. `http_action_send-request`.
   * Optionally `appId.actionId` (first segment before `.` used as appId when
   * `appId` is omitted and the id contains a dot that is not part of the
   * usual `_action_` pattern).
   */
  id: string;
  /** Workflow app id. Inferred from `id` when it matches `{app}_action_…`. */
  appId?: string;
  /** Optional Connection ref. Omit to let the platform resolve. */
  connection?: ConnectionDefinition;
  /** Default input merged at run/deploy time. */
  input?: Record<string, unknown>;
  name?: string;
  description?: string;
}

/** One field on a Manually Run trigger. Stored as `customInputConfig`. */
export interface TriggerInputFieldDefinition {
  /** Field id. Callers pass this key to `workflows.execute`. */
  id: string;
  label?: string;
  description?: string;
  /** `text`, `number`, `date`, or `select`. Defaults to `text` on deploy. */
  inputType?: string;
  required?: boolean | { missingMessage?: string; missingStatus?: string };
  defaultValue?: unknown;
  selectOptions?: Array<{ label?: string; value?: string }>;
}

/** Ref to a catalogue trigger. Credentials stay on the connection, when one is set. */
export interface TriggerDefinition {
  kind: typeof DEFINE_KINDS.trigger;
  /**
   * Catalogue trigger id, e.g. `flow-control_trigger_manual`.
   * Discover with `apps get <appId> --json` (`triggers[].triggerId`).
   */
  id: string;
  /** Workflow app id. Inferred from `id` when it matches `{app}_trigger_…`. */
  appId?: string;
  /** Optional Connection ref. Omit to let the platform resolve. */
  connection?: ConnectionDefinition;
  /** Catalogue trigger config (webhook method, schedule, app trigger fields). */
  input?: Record<string, unknown>;
  /** Manual-trigger fields. Stored as `customInputConfig`. */
  inputs?: TriggerInputFieldDefinition[];
  name?: string;
  description?: string;
}

export interface WorkflowStepDefinition {
  /** Action definition (or inline action-shaped object). */
  use: ActionDefinition;
  /** Per-step input overrides. */
  input?: Record<string, unknown>;
  name?: string;
}

export interface WorkflowDefinition {
  kind: typeof DEFINE_KINDS.workflow;
  /** Stable slug, unique in the workspace (upsert key). */
  slug: string;
  name?: string;
  description?: string;
  isActive?: boolean;
  /**
   * Catalogue trigger. Omit for Manually Run with no input fields.
   * `runs.start` ignores this and runs the steps only.
   */
  trigger?: TriggerDefinition;
  /** Linear steps (v1; no branches). */
  steps: WorkflowStepDefinition[];
}

export type AgentToolDefinition =
  | ActionDefinition
  | WorkflowDefinition
  | { use: ActionDefinition | WorkflowDefinition };

export interface AgentDefinition {
  kind: typeof DEFINE_KINDS.agent;
  /** Stable slug, unique in the workspace (upsert key). */
  slug: string;
  name?: string;
  description?: string;
  /**
   * Catalogue model id from `ai-connections list` (`models[].id`).
   * Example on Lunnoa LLMs: `deepseek-ai/DeepSeek-V4-Pro`.
   */
  model: string;
  instructions: string;
  aiConnection?: AiConnectionDefinition;
  /** App Connection refs the agent may use for tools. */
  connections?: ConnectionDefinition[];
  /** Action and/or workflow tool refs. */
  tools?: AgentToolDefinition[];
}

export function defineConnection(
  config: Omit<ConnectionDefinition, 'kind'> = {},
): ConnectionDefinition {
  return { kind: DEFINE_KINDS.connection, ...config };
}

export function defineAiConnection(
  config: Omit<AiConnectionDefinition, 'kind'> = {},
): AiConnectionDefinition {
  return { kind: DEFINE_KINDS.aiConnection, ...config };
}

export function defineAction(
  config: Omit<ActionDefinition, 'kind'>,
): ActionDefinition {
  if (!config.id?.trim()) {
    throw new Error('defineAction requires id (catalogue action id)');
  }
  return { kind: DEFINE_KINDS.action, ...config };
}

function assertTriggerConfig(config: Omit<TriggerDefinition, 'kind'>): void {
  if (!config.id?.trim()) {
    throw new Error('defineTrigger requires id (catalogue trigger id)');
  }
  for (const field of config.inputs ?? []) {
    if (!field?.id?.trim()) {
      throw new Error('defineTrigger inputs require id');
    }
  }
  if (
    config.inputs?.length &&
    config.id.trim() !== 'flow-control_trigger_manual'
  ) {
    throw new Error(
      'defineTrigger inputs are only valid on flow-control_trigger_manual',
    );
  }
}

export function defineTrigger(
  config: Omit<TriggerDefinition, 'kind'>,
): TriggerDefinition {
  assertTriggerConfig(config);
  return { kind: DEFINE_KINDS.trigger, ...config };
}

export function defineWorkflow(
  config: Omit<WorkflowDefinition, 'kind'>,
): WorkflowDefinition {
  if (!config.slug?.trim()) {
    throw new Error('defineWorkflow requires slug');
  }
  if (!config.steps?.length) {
    throw new Error('defineWorkflow requires at least one step');
  }
  if (config.trigger) {
    assertTriggerConfig(config.trigger);
  }
  return { kind: DEFINE_KINDS.workflow, ...config };
}

export function defineAgent(
  config: Omit<AgentDefinition, 'kind'>,
): AgentDefinition {
  if (!config.slug?.trim()) {
    throw new Error('defineAgent requires slug');
  }
  if (!config.model?.trim()) {
    throw new Error('defineAgent requires model');
  }
  if (config.instructions == null) {
    throw new Error('defineAgent requires instructions');
  }
  return { kind: DEFINE_KINDS.agent, ...config };
}

export interface EntityTypeDefinition {
  kind: typeof DEFINE_KINDS.entityType;
  /** Stable deployment-wide slug (upsert key). Granted to the deployer's workspace when new. */
  slug: string;
  name?: string;
  namePlural?: string;
  description?: string;
  icon?: string;
  color?: string;
  /** Field definitions grouped into sections (same contract as Adminspace). */
  attributeSchema: Record<string, unknown>;
  stateSchema?: Record<string, unknown> | null;
  isEnabled?: boolean;
  /**
   * When false (default), entity writes reject undeclared attribute keys.
   * Reserved key `extensions` is always allowed as a JSON object.
   */
  allowUnknownAttributes?: boolean;
}

export function defineEntityType(
  config: Omit<EntityTypeDefinition, 'kind'>,
): EntityTypeDefinition {
  if (!config.slug?.trim()) {
    throw new Error('defineEntityType requires slug');
  }
  if (
    !config.attributeSchema ||
    typeof config.attributeSchema !== 'object' ||
    Array.isArray(config.attributeSchema)
  ) {
    throw new Error('defineEntityType requires attributeSchema object');
  }
  return {
    kind: DEFINE_KINDS.entityType,
    allowUnknownAttributes: false,
    ...config,
  };
}

/** Infer appId from catalogue action ids like `http_action_send-request`. */
export function resolveActionAppId(action: ActionDefinition): string {
  if (action.appId?.trim()) {
    return action.appId.trim();
  }
  const id = action.id.trim();
  const actionMarker = '_action_';
  const markerIndex = id.indexOf(actionMarker);
  if (markerIndex > 0) {
    return id.slice(0, markerIndex);
  }
  const dot = id.indexOf('.');
  if (dot > 0) {
    return id.slice(0, dot);
  }
  throw new Error(
    `Cannot infer appId for action "${id}". Pass appId explicitly.`,
  );
}

/** Infer appId from catalogue trigger ids like `flow-control_trigger_manual`. */
export function resolveTriggerAppId(trigger: TriggerDefinition): string {
  if (trigger.appId?.trim()) {
    return trigger.appId.trim();
  }
  const id = trigger.id.trim();
  const marker = '_trigger_';
  const markerIndex = id.indexOf(marker);
  if (markerIndex > 0) {
    return id.slice(0, markerIndex);
  }
  const dot = id.indexOf('.');
  if (dot > 0) {
    return id.slice(0, dot);
  }
  throw new Error(
    `Cannot infer appId for trigger "${id}". Pass appId explicitly.`,
  );
}

export function resolveTriggerId(trigger: TriggerDefinition): string {
  const id = trigger.id.trim();
  const appId = trigger.appId?.trim();
  if (appId && id.startsWith(`${appId}.`)) {
    return id.slice(appId.length + 1);
  }
  const marker = '_trigger_';
  if (id.includes(marker)) {
    return id;
  }
  const dot = id.indexOf('.');
  if (dot > 0) {
    return id.slice(dot + 1);
  }
  return id;
}

export function resolveActionId(action: ActionDefinition): string {
  const id = action.id.trim();
  const appId = action.appId?.trim();
  if (appId && id.startsWith(`${appId}.`)) {
    return id.slice(appId.length + 1);
  }
  const marker = '_action_';
  if (id.includes(marker)) {
    return id;
  }
  const dot = id.indexOf('.');
  if (dot > 0) {
    return id.slice(dot + 1);
  }
  return id;
}
