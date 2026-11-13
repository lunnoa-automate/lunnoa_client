/**
 * Pure typed definition factories for local workflow/agent authoring.
 * These do not call the network. Deploy with the CLI; run ad-hoc with `runs.start`.
 *
 * Not the same as `@lunnoa/toolkit` `createAction` / `createApp` (in-platform apps).
 */

import {
  acceptAgentFile,
  acceptWorkflowGraphFile,
  acceptWorkflowStepsFile,
  isAgentFileInput,
  isWorkflowGraphInput,
  isWorkflowStepsFile,
} from './files';
import type {
  AgentFileDefinition,
  AgentFileInput,
  WorkflowGraphFileDefinition,
  WorkflowGraphFileInput,
  WorkflowStepsFileDefinition,
  WorkflowStepsFileInput,
} from './files';

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
  /**
   * Name later steps use with `ref.step(key, ...)`. Keyed steps keep their
   * node id across deploys. `trigger` is reserved.
   */
  key?: string;
  /** Action definition (or inline action-shaped object). */
  use: ActionDefinition;
  /** Per-step input overrides. Values may contain `ref.trigger` / `ref.step`. */
  input?: Record<string, unknown>;
  name?: string;
  description?: string;
  retrySettings?: {
    enabled: boolean;
    maxAttempts: number;
    delaySeconds: number;
  };
  continueOnFailure?: { enabled: boolean };
  /**
   * Branches after this step. Only on Conditional Paths, Manually Decide Path,
   * or Request Approval (approved path first, then rejected), and only on the
   * last step of a list. Put later steps inside each path.
   */
  paths?: WorkflowPathDefinition[];
}

/** Conditions Conditional Paths evaluates (same list as the builder). */
export const PATH_CONDITIONS = [
  'contains',
  'does_not_contain',
  'equals',
  'does_not_equal',
  'exists',
  'does_not_exist',
  'starts_with',
  'ends_with',
  'is_empty',
  'is_not_empty',
  'comes_before',
  'comes_after',
  'is_in_the_past',
  'is_in_the_future',
  'is_true',
  'is_false',
  'is_truthy',
  'is_falsey',
  'is_greater_than',
  'is_less_than',
  'is_greater_than_or_equal_to',
  'is_less_than_or_equal_to',
  'matches_regex',
  'does_not_match_regex',
] as const;

export type PathConditionType = (typeof PATH_CONDITIONS)[number];

export interface PathCondition {
  /** One reference: `ref.trigger(...)` or `ref.step(...)`. */
  field: string;
  condition: PathConditionType;
  /** Compared as text. Omit for exists / is_empty / is_true and similar. */
  value?: string;
}

export interface WorkflowPathDefinition {
  /** Unique on its step. On Request Approval use `Approved` / `Rejected`. */
  label: string;
  /**
   * Conditional Paths only. Groups are OR-ed, conditions in a group AND-ed.
   * Omit to always take this path.
   */
  when?: PathCondition[][];
  steps: WorkflowStepDefinition[];
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
  /** Steps in order. The last step may branch with `paths`. */
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
  if (config.inputs?.length && config.id.trim() !== MANUAL_TRIGGER_ID) {
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

const MANUAL_TRIGGER_ID = 'flow-control_trigger_manual';
const TRIGGER_KEY = 'trigger';
const STEP_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;
const STEP_REF_PATTERN = /={{step:([^}]*)}}/g;

function refString(key: string, path: Array<string | number>): string {
  const parts = [key, ...path.map(String)];
  for (const part of parts) {
    if (!part || /[,{}]/.test(part)) {
      throw new Error(`ref path parts must be non-empty and contain no , { or }: "${part}"`);
    }
  }
  return `={{step:${parts.join(',')}}}`;
}

/**
 * References for step inputs. The server swaps them for the real node ids on
 * deploy, and the builder shows them as mapped fields from earlier nodes.
 * They are plain strings, so they also work inside text and nested objects.
 */
export const ref = {
  /** A trigger output field, e.g. a Manually Run input id. */
  trigger: (field: string, ...path: Array<string | number>): string =>
    refString(TRIGGER_KEY, [field, ...path]),
  /** An earlier step's output, by its `key`. Array indexes are numbers. */
  step: (key: string, ...path: Array<string | number>): string =>
    refString(key, path),
};

function collectRefs(value: unknown, out: string[][]): void {
  if (typeof value === 'string') {
    for (const match of value.matchAll(STEP_REF_PATTERN)) {
      out.push(match[1].split(',').map((part) => part.trim()));
    }
  } else if (Array.isArray(value)) {
    value.forEach((item) => collectRefs(item, out));
  } else if (value && typeof value === 'object') {
    Object.values(value).forEach((item) => collectRefs(item, out));
  }
}

const CONDITIONAL_PATHS_ID = 'flow-control_action_conditional-paths';
const APPROVAL_ID = 'flow-control_action_request-approval';
const BRANCHING_ACTION_IDS = new Set([
  CONDITIONAL_PATHS_ID,
  'flow-control_action_manually-decide-paths',
  APPROVAL_ID,
]);
const PATH_CONDITION_SET = new Set<string>(PATH_CONDITIONS);
const SINGLE_REF_PATTERN = /^={{step:[^}]*}}$/;

function collectKeys(steps: WorkflowStepDefinition[], seen: Set<string>): void {
  for (const step of steps) {
    if (step.key !== undefined) {
      if (!STEP_KEY_PATTERN.test(step.key) || step.key === TRIGGER_KEY) {
        throw new Error(
          `Step key "${step.key}" must start with a letter, use letters, digits, - or _, and not be "${TRIGGER_KEY}".`,
        );
      }
      if (seen.has(step.key)) {
        throw new Error(`Step key "${step.key}" is used twice.`);
      }
      seen.add(step.key);
    }
    for (const path of step.paths ?? []) collectKeys(path.steps ?? [], seen);
  }
}

/** Same checks the server runs on deploy, so mistakes show up locally. */
function assertStepRefs(config: Omit<WorkflowDefinition, 'kind'>): void {
  const triggerId = config.trigger?.id.trim() ?? MANUAL_TRIGGER_ID;
  const triggerFields =
    triggerId === MANUAL_TRIGGER_ID
      ? new Set((config.trigger?.inputs ?? []).map((f) => f.id.trim()))
      : undefined;
  const allKeys = new Set<string>();
  collectKeys(config.steps, allKeys);

  const checkRefs = (value: unknown, earlier: Set<string>, where: string) => {
    const refs: string[][] = [];
    collectRefs(value, refs);
    for (const [key = '', ...path] of refs) {
      const shown = `={{step:${[key, ...path].join(',')}}}`;
      if (!earlier.has(key)) {
        throw new Error(
          allKeys.has(key)
            ? `${where}: ${shown} refers to itself, a later step, or a step on another path. Use the trigger or an earlier step on the same path.`
            : `${where}: ${shown} names unknown key "${key}". Use "trigger" or an earlier step's key.`,
        );
      }
      if (key === TRIGGER_KEY && triggerFields && !triggerFields.has(path[0] ?? '')) {
        throw new Error(
          `${where}: ${shown} uses trigger field "${path[0] ?? ''}", which is not declared in trigger inputs.`,
        );
      }
    }
  };

  const checkChain = (steps: WorkflowStepDefinition[], visible: Set<string>) => {
    const earlier = new Set(visible);
    steps.forEach((step, index) => {
      const where = `Step "${step.key ?? step.name ?? index + 1}"`;
      checkRefs([step.use?.input, step.input], earlier, where);
      if (step.key) earlier.add(step.key);
      if (!step.paths?.length) return;

      const actionId = step.use ? resolveActionId(step.use) : '';
      if (!BRANCHING_ACTION_IDS.has(actionId)) {
        throw new Error(`${where}: paths only work on ${[...BRANCHING_ACTION_IDS].join(', ')}.`);
      }
      if (index !== steps.length - 1) {
        throw new Error(
          `${where}: a step with paths must be the last step in its list. Put later steps inside each path.`,
        );
      }
      if (actionId === APPROVAL_ID && step.paths.length > 2) {
        throw new Error(`${where}: Request Approval takes at most two paths (approved, then rejected).`);
      }
      const labels = new Set<string>();
      for (const path of step.paths) {
        const label = path?.label?.trim();
        if (!label) throw new Error(`${where}: every path needs a label.`);
        if (labels.has(label)) throw new Error(`${where}: path label "${label}" is used twice.`);
        labels.add(label);
        if (path.when !== undefined && actionId !== CONDITIONAL_PATHS_ID) {
          throw new Error(`${where}: "when" only works on Conditional Paths.`);
        }
        for (const condition of (path.when ?? []).flat()) {
          if (!SINGLE_REF_PATTERN.test(condition?.field?.trim() ?? '')) {
            throw new Error(
              `${where}, path "${label}": a condition's field must be one ref.trigger(...) or ref.step(...).`,
            );
          }
          if (!PATH_CONDITION_SET.has(condition.condition)) {
            throw new Error(
              `${where}, path "${label}": condition "${condition.condition}" is not supported. Use one of: ${PATH_CONDITIONS.join(', ')}.`,
            );
          }
        }
        checkRefs(path.when, earlier, `${where}, path "${label}"`);
        if (!path.steps?.length) throw new Error(`${where}: path "${label}" needs at least one step.`);
        checkChain(path.steps, earlier);
      }
    });
  };

  checkChain(config.steps, new Set([TRIGGER_KEY]));
}

export function defineWorkflow(
  config: Omit<WorkflowDefinition, 'kind'>,
): WorkflowDefinition;
export function defineWorkflow(config: WorkflowStepsFileInput): WorkflowStepsFileDefinition;
export function defineWorkflow(config: WorkflowGraphFileInput): WorkflowGraphFileDefinition;
export function defineWorkflow(
  config:
    | Omit<WorkflowDefinition, 'kind'>
    | WorkflowStepsFileInput
    | WorkflowGraphFileInput,
): WorkflowDefinition | WorkflowStepsFileDefinition | WorkflowGraphFileDefinition {
  const record = config as { format?: string; nodes?: unknown; steps?: unknown };
  if (
    isWorkflowGraphInput(config) ||
    (Array.isArray(record.nodes) && !Array.isArray(record.steps))
  ) {
    return acceptWorkflowGraphFile(config as WorkflowGraphFileInput);
  }
  if (isWorkflowStepsFile(config)) {
    return acceptWorkflowStepsFile(config);
  }
  const authored = { ...(config as Omit<WorkflowDefinition, 'kind'> & { $schema?: string }) };
  delete authored.$schema;
  if (!authored.slug?.trim()) {
    throw new Error('defineWorkflow requires slug');
  }
  if (!authored.steps?.length) {
    throw new Error('defineWorkflow requires at least one step');
  }
  if (authored.trigger) {
    assertTriggerConfig(authored.trigger);
  }
  assertStepRefs(authored);
  return { kind: DEFINE_KINDS.workflow, ...authored };
}

export function defineAgent(config: Omit<AgentDefinition, 'kind'>): AgentDefinition;
export function defineAgent(config: AgentFileInput): AgentFileDefinition;
export function defineAgent(
  config: Omit<AgentDefinition, 'kind'> | AgentFileInput,
): AgentDefinition | AgentFileDefinition {
  if (isAgentFileInput(config)) {
    return acceptAgentFile(config);
  }
  const authored = { ...(config as Omit<AgentDefinition, 'kind'> & { $schema?: string }) };
  delete authored.$schema;
  if (!authored.slug?.trim()) {
    throw new Error('defineAgent requires slug');
  }
  if (!authored.model?.trim()) {
    throw new Error('defineAgent requires model');
  }
  if (authored.instructions == null) {
    throw new Error('defineAgent requires instructions');
  }
  return { kind: DEFINE_KINDS.agent, ...authored };
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

export type {
  AgentFileDefinition,
  AgentFileInput,
  AgentFileSettings,
  AgentFileTool,
  AgentLinkById,
  AgentLinkBySlug,
  AgentSlugOrId,
  ContinueOnFailureSettings,
  RetrySettings,
  WorkflowFileDefinition,
  WorkflowGraphEdge,
  WorkflowGraphFileDefinition,
  WorkflowGraphFileInput,
  WorkflowGraphNode,
  WorkflowStepFile,
  WorkflowStepsFileDefinition,
  WorkflowStepsFileInput,
  WorkflowTriggerFile,
  WorkflowUseFile,
} from './files';
export { isAgentFileShape } from './files';

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
