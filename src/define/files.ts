/**
 * On-disk agent and workflow definitions (the pull/push file shape).
 * `$schema` is allowed on input and stripped; the CLI adds it when writing.
 */

export interface RetrySettings {
  enabled: boolean;
  maxAttempts: number;
  delaySeconds: number;
}

export interface ContinueOnFailureSettings {
  enabled: boolean;
}

/** Every key is present on files the API returns. Hand-written files may omit unset keys. */
export interface AgentFileSettings {
  temperature?: number;
  topP?: number;
  maxOutputTokens?: number | null;
  frequencyPenalty?: number;
  presencePenalty?: number;
  seed?: number | null;
  maxRetries?: number;
  maxToolRoundtrips?: number;
  messageLookbackLimit?: number;
  taskNamingInstructions?: string | null;
  enabledBuiltInTools?: string[];
  enabledPlatformTools?: string[];
  enabledToolPolicies?: string[];
  forcedTools?: unknown;
  suggestedPrompts?: string[];
  dynamicActionDiscoveryEnabled?: boolean;
  dynamicMcpDiscoveryEnabled?: boolean;
  dynamicSelfInstructionsEnabled?: boolean;
  memoryEnabled?: boolean;
  memoryScope?: string;
  memoryRetentionDays?: number;
  enablePlanning?: boolean;
  requirePlanApproval?: boolean;
  enableToolResultOffload?: boolean;
  toolResultOffloadThresholdBytes?: number;
  longHorizonMode?: boolean;
  longHorizonMaxSteps?: number | null;
  longHorizonMaxTokensPerRun?: number | null;
  piiRoutingMode?: string;
  piiFallbackConnectionId?: string | null;
  piiFallbackModelId?: string | null;
  webAccess?: boolean | null;
  phoneAccess?: boolean | null;
}

export interface AgentFileTool {
  key: string;
  /** Catalogue action id. */
  id: string;
  appId?: string;
  connection?: { id: string };
  name: string;
  description?: string;
  input: Record<string, unknown>;
}

export interface AgentLinkBySlug {
  slug: string;
}

export interface AgentLinkById {
  id: string;
}

export type AgentSlugOrId = AgentLinkBySlug | AgentLinkById;

export interface AgentFileDefinition {
  kind: 'agent';
  slug: string;
  name: string;
  description?: string;
  model?: string;
  aiConnection?: { id: string };
  /**
   * API and TypeScript use a string. Files on disk point at
   * `<slug>.instructions.md`; only the CLI reads that file.
   */
  instructions: string | { file: string };
  settings: AgentFileSettings;
  tools: AgentFileTool[];
  workflows: AgentSlugOrId[];
  agents: AgentSlugOrId[];
  connections: AgentLinkById[];
  knowledge: AgentLinkById[];
  variables: AgentLinkById[];
  objects: AgentLinkById[];
  objectTypes: AgentLinkById[];
  mcpServers: Array<{ id: string; connectionId?: string }>;
  a2aAgents: AgentLinkById[];
}

/** Authoring / `JSON.parse` input. Lists and settings may be omitted; pulled files include them. */
export type AgentFileInput = Omit<
  AgentFileDefinition,
  | 'kind'
  | 'name'
  | 'instructions'
  | 'settings'
  | 'tools'
  | 'workflows'
  | 'agents'
  | 'connections'
  | 'knowledge'
  | 'variables'
  | 'objects'
  | 'objectTypes'
  | 'mcpServers'
  | 'a2aAgents'
> & {
  $schema?: string;
  kind?: 'agent';
  name?: string;
  instructions: string | { file: string };
  settings?: Partial<AgentFileSettings>;
  tools?: AgentFileTool[];
  workflows?: AgentSlugOrId[];
  agents?: AgentSlugOrId[];
  connections?: AgentLinkById[];
  knowledge?: AgentLinkById[];
  variables?: AgentLinkById[];
  objects?: AgentLinkById[];
  objectTypes?: AgentLinkById[];
  mcpServers?: Array<{ id: string; connectionId?: string }>;
  a2aAgents?: AgentLinkById[];
};

export interface WorkflowUseFile {
  id: string;
  appId?: string;
  connection?: { id: string };
}

export interface WorkflowTriggerFile {
  id: string;
  appId?: string;
  connection?: { id: string };
  input?: Record<string, unknown>;
  inputs?: Array<Record<string, unknown>>;
  name: string;
  description?: string;
}

export interface WorkflowStepFile {
  key: string;
  name: string;
  description?: string;
  use: WorkflowUseFile;
  input: Record<string, unknown>;
  retrySettings?: RetrySettings;
  continueOnFailure?: ContinueOnFailureSettings;
  paths?: Array<{
    label: string;
    when?: Array<Array<{ field: string; condition: string; value?: string }>>;
    steps: WorkflowStepFile[];
  }>;
}

export interface WorkflowStepsFileDefinition {
  kind: 'workflow';
  format: 'steps';
  slug: string;
  name: string;
  description?: string;
  trigger: WorkflowTriggerFile;
  steps: WorkflowStepFile[];
}

export type WorkflowStepsFileInput = Omit<WorkflowStepsFileDefinition, 'kind'> & {
  $schema?: string;
  kind?: 'workflow';
};

export interface WorkflowGraphNode {
  id?: string;
  key: string;
  nodeType: 'trigger' | 'action';
  appId: string;
  actionId?: string;
  triggerId?: string;
  name: string;
  description?: string;
  value: Record<string, unknown>;
  retrySettings?: Record<string, unknown>;
  continueOnFailure?: Record<string, unknown>;
  [other: string]: unknown;
}

export interface WorkflowGraphEdge {
  id?: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  type?: string;
}

export interface WorkflowGraphFileDefinition {
  kind: 'workflow';
  format: 'graph';
  slug: string;
  name: string;
  description?: string;
  nodes: WorkflowGraphNode[];
  edges: WorkflowGraphEdge[];
}

export type WorkflowGraphFileInput = Omit<WorkflowGraphFileDefinition, 'kind'> & {
  $schema?: string;
  kind?: 'workflow';
};

export type WorkflowFileDefinition =
  | WorkflowStepsFileDefinition
  | WorkflowGraphFileDefinition;

const STEP_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;

function hasFileAgentSignals(record: Record<string, unknown>): boolean {
  if (record.instructions && typeof record.instructions === 'object') return true;
  if (record.settings && typeof record.settings === 'object') return true;
  if (
    'workflows' in record ||
    'agents' in record ||
    'knowledge' in record ||
    'variables' in record ||
    'objects' in record ||
    'objectTypes' in record ||
    'mcpServers' in record ||
    'a2aAgents' in record
  ) {
    return true;
  }
  return (
    Array.isArray(record.tools) &&
    record.tools.some(
      (tool) =>
        tool &&
        typeof tool === 'object' &&
        !('kind' in tool) &&
        !('use' in tool),
    )
  );
}

export function isAgentFileInput(config: unknown): config is AgentFileInput {
  if (!config || typeof config !== 'object') return false;
  return hasFileAgentSignals(config as Record<string, unknown>);
}

/** True for a file-shaped agent after `$schema` has been stripped. */
export function isAgentFileShape(config: unknown): config is AgentFileDefinition {
  if (!config || typeof config !== 'object') return false;
  return hasFileAgentSignals(config as Record<string, unknown>);
}

export function acceptAgentFile(config: AgentFileInput): AgentFileDefinition {
  const slug = config.slug?.trim();
  if (!slug) throw new Error('defineAgent requires slug');
  const instructions = config.instructions;
  const fileRef =
    instructions &&
    typeof instructions === 'object' &&
    typeof instructions.file === 'string' &&
    instructions.file.trim().length > 0;
  if (typeof instructions !== 'string' && !fileRef) {
    throw new Error('defineAgent requires instructions');
  }
  const copy = { ...config } as Record<string, unknown>;
  delete copy.$schema;
  delete copy.kind;
  return { ...copy, kind: 'agent', slug, instructions } as AgentFileDefinition;
}

function assertStepKeys(steps: WorkflowStepFile[], seen: Set<string>): void {
  for (const step of steps ?? []) {
    if (!step?.use?.id?.trim()) {
      throw new Error('workflow step requires use.id');
    }
    if (step.key !== undefined) {
      if (!STEP_KEY_PATTERN.test(step.key) || step.key === 'trigger') {
        throw new Error(
          `Step key "${step.key}" must start with a letter, use letters, digits, - or _, and not be "trigger".`,
        );
      }
      if (seen.has(step.key)) {
        throw new Error(`Step key "${step.key}" is used twice.`);
      }
      seen.add(step.key);
    }
    for (const path of step.paths ?? []) {
      assertStepKeys(path.steps ?? [], seen);
    }
  }
}

export function acceptWorkflowStepsFile(
  config: WorkflowStepsFileInput,
): WorkflowStepsFileDefinition {
  const slug = config.slug?.trim();
  if (!slug) throw new Error('defineWorkflow requires slug');
  if (!config.steps?.length) {
    throw new Error('defineWorkflow requires at least one step');
  }
  if (config.trigger && !config.trigger.id?.trim()) {
    throw new Error('defineWorkflow trigger requires id');
  }
  assertStepKeys(config.steps, new Set());
  const copy = { ...config } as Record<string, unknown>;
  delete copy.$schema;
  delete copy.kind;
  return {
    ...copy,
    kind: 'workflow',
    format: 'steps',
    slug,
  } as WorkflowStepsFileDefinition;
}

export function acceptWorkflowGraphFile(
  config: WorkflowGraphFileInput,
): WorkflowGraphFileDefinition {
  const slug = config.slug?.trim();
  if (!slug) throw new Error('defineWorkflow requires slug');
  if (!Array.isArray(config.nodes) || config.nodes.length === 0) {
    throw new Error('defineWorkflow graph requires nodes');
  }
  const keys = new Set<string>();
  let triggers = 0;
  for (const node of config.nodes) {
    if (!node?.key || typeof node.key !== 'string') {
      throw new Error('graph node requires key');
    }
    if (!STEP_KEY_PATTERN.test(node.key)) {
      throw new Error(
        `Node key "${node.key}" must start with a letter, use letters, digits, - or _, and not be empty.`,
      );
    }
    if (keys.has(node.key)) {
      throw new Error(`Node key "${node.key}" is used twice.`);
    }
    keys.add(node.key);
    if (node.nodeType === 'trigger') triggers += 1;
  }
  if (triggers !== 1) {
    throw new Error('defineWorkflow graph requires exactly one trigger');
  }
  for (const edge of config.edges ?? []) {
    if (!keys.has(edge?.source) || !keys.has(edge?.target)) {
      throw new Error(
        `Edge from "${edge?.source ?? ''}" to "${edge?.target ?? ''}" references an unknown key.`,
      );
    }
  }
  const copy = { ...config } as Record<string, unknown>;
  delete copy.$schema;
  delete copy.kind;
  return {
    ...copy,
    kind: 'workflow',
    format: 'graph',
    slug,
    edges: config.edges ?? [],
  } as WorkflowGraphFileDefinition;
}

export function isWorkflowGraphInput(config: unknown): config is WorkflowGraphFileInput {
  return (
    !!config &&
    typeof config === 'object' &&
    (config as { format?: string }).format === 'graph'
  );
}

export function isWorkflowStepsFile(config: unknown): config is WorkflowStepsFileInput {
  if (!config || typeof config !== 'object') return false;
  const record = config as Record<string, unknown>;
  if (record.format === 'steps') return true;
  if (
    record.trigger &&
    typeof record.trigger === 'object' &&
    (record.trigger as { kind?: string }).kind !== 'trigger' &&
    typeof (record.trigger as { id?: string }).id === 'string'
  ) {
    return true;
  }
  return (
    Array.isArray(record.steps) &&
    record.steps.some(
      (step) =>
        step &&
        typeof step === 'object' &&
        (step as { use?: { kind?: string } }).use &&
        (step as { use?: { kind?: string } }).use?.kind !== 'action',
    )
  );
}
