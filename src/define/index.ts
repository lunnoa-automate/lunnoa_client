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
  workflow: 'workflow',
  agent: 'agent',
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

export interface WorkflowStepDefinition {
  /** Action definition (or inline action-shaped object). */
  use: ActionDefinition;
  /** Per-step input overrides. */
  input?: Record<string, unknown>;
  name?: string;
}

export interface WorkflowDefinition {
  kind: typeof DEFINE_KINDS.workflow;
  /** Stable project-scoped slug (upsert key). */
  slug: string;
  name?: string;
  description?: string;
  isActive?: boolean;
  /** Linear steps (v1; no branches). */
  steps: WorkflowStepDefinition[];
}

export type AgentToolDefinition =
  | ActionDefinition
  | WorkflowDefinition
  | { use: ActionDefinition | WorkflowDefinition };

export interface AgentDefinition {
  kind: typeof DEFINE_KINDS.agent;
  /** Stable project-scoped slug (upsert key). */
  slug: string;
  name?: string;
  description?: string;
  /** Selected model id on the AI provider connection. */
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

export function defineWorkflow(
  config: Omit<WorkflowDefinition, 'kind'>,
): WorkflowDefinition {
  if (!config.slug?.trim()) {
    throw new Error('defineWorkflow requires slug');
  }
  if (!config.steps?.length) {
    throw new Error('defineWorkflow requires at least one step');
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
