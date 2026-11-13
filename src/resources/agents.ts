import type { HttpClient } from '../core/http';
import type { Agent, CodeDefinitionResponse, CodeSource } from '../types';
import type {
  ActionDefinition,
  AgentDefinition,
  AgentFileDefinition,
  AgentFileInput,
  AgentFileSettings,
  AgentSlugOrId,
  AgentToolDefinition,
  WorkflowDefinition,
} from '../define';
import {
  DEFINE_KINDS,
  isAgentFileShape,
  resolveActionAppId,
  resolveActionId,
} from '../define';
import { serializeListQuery, type ListQueryOptions } from './common';

export interface UpsertAgentToolInput {
  key?: string;
  appId: string;
  actionId: string;
  connectionId?: string;
  name?: string;
  description?: string;
  input?: Record<string, unknown>;
}

export interface UpsertAgentBySlugInput {
  slug: string;
  name?: string;
  /** Null clears a description that was removed from the definition file. */
  description?: string | null;
  instructions: string;
  /** Null clears a model that was removed from the definition file. */
  model?: string | null;
  aiConnectionId?: string;
  connectionIds?: string[];
  workflowIds?: string[];
  tools?: UpsertAgentToolInput[];
  settings?: Partial<AgentFileSettings>;
  workflows?: AgentSlugOrId[];
  agents?: AgentSlugOrId[];
  knowledgeIds?: string[];
  variableIds?: string[];
  objectIds?: string[];
  objectTypeIds?: string[];
  mcpServers?: Array<{ id: string; connectionId?: string }>;
  a2aAgentIds?: string[];
  /** `generated` for TypeScript deploys, `synced` for definition files. */
  codeSource?: Extract<CodeSource, 'synced' | 'generated'>;
  baseRevision?: string;
  force?: boolean;
}

export interface AgentUpsertOptions {
  workflowIds?: string[];
  codeSource?: Extract<CodeSource, 'synced' | 'generated'>;
  baseRevision?: string;
  force?: boolean;
}

function unwrapTool(
  tool: AgentToolDefinition,
): ActionDefinition | WorkflowDefinition {
  if ('use' in tool && tool.use) {
    return tool.use;
  }
  return tool as ActionDefinition | WorkflowDefinition;
}

function syncFields(options?: AgentUpsertOptions): Pick<
  UpsertAgentBySlugInput,
  'codeSource' | 'baseRevision' | 'force'
> {
  return {
    ...(options?.baseRevision ? { baseRevision: options.baseRevision } : {}),
    ...(options?.force ? { force: true } : {}),
  };
}

function idsOf(links: Array<{ id: string }> | undefined): string[] | undefined {
  if (!links) return undefined;
  return links.map((link) => link.id);
}

export function agentDefinitionToUpsert(
  def: AgentDefinition | AgentFileDefinition | AgentFileInput,
  options?: AgentUpsertOptions,
): UpsertAgentBySlugInput {
  if (isAgentFileShape(def)) {
    return fileAgentToUpsert(def as AgentFileDefinition, options);
  }

  const tools: UpsertAgentToolInput[] = [];
  const workflowIds = [...(options?.workflowIds ?? [])];
  const authored = def as AgentDefinition;

  for (const tool of authored.tools ?? []) {
    const unwrapped = unwrapTool(tool);
    if (unwrapped.kind === DEFINE_KINDS.workflow) {
      // Workflow tools are linked via AgentWorkflow (workflowIds), not tools[].
      // Callers should deploy workflows first and pass resolved UUIDs.
      continue;
    }
    if (unwrapped.kind === DEFINE_KINDS.action) {
      tools.push({
        appId: resolveActionAppId(unwrapped),
        actionId: resolveActionId(unwrapped),
        connectionId: unwrapped.connection?.id,
        name: unwrapped.name,
        description: unwrapped.description,
        input: unwrapped.input,
      });
    }
  }

  return {
    slug: authored.slug,
    name: authored.name,
    description: authored.description,
    instructions: authored.instructions,
    model: authored.model,
    aiConnectionId: authored.aiConnection?.id,
    connectionIds: authored.connections
      ?.map((c) => c.id)
      .filter((id): id is string => Boolean(id)),
    workflowIds: workflowIds.length ? workflowIds : undefined,
    tools,
    codeSource: options?.codeSource ?? 'generated',
    ...syncFields(options),
  };
}

function fileAgentToUpsert(
  def: AgentFileDefinition,
  options?: AgentUpsertOptions,
): UpsertAgentBySlugInput {
  if (typeof def.instructions !== 'string') {
    throw new Error(
      'Agent instructions are still a file reference. The CLI resolves these before push.',
    );
  }
  const tools: UpsertAgentToolInput[] = [];
  for (const tool of def.tools ?? []) {
    const action = {
      kind: DEFINE_KINDS.action,
      id: tool.id,
      appId: tool.appId,
      connection: tool.connection?.id
        ? { kind: DEFINE_KINDS.connection, id: tool.connection.id }
        : undefined,
    } satisfies ActionDefinition;
    tools.push({
      key: tool.key,
      appId: resolveActionAppId(action),
      actionId: resolveActionId(action),
      connectionId: tool.connection?.id,
      name: tool.name,
      description: tool.description,
      input: tool.input,
    });
  }
  return {
    slug: def.slug,
    name: def.name,
    // A file is the whole definition. Omitted description and model are empty.
    description: def.description ?? null,
    instructions: def.instructions,
    model: def.model ?? null,
    aiConnectionId: def.aiConnection?.id,
    ...(def.settings ? { settings: def.settings } : {}),
    ...(def.tools ? { tools } : {}),
    ...(def.workflows ? { workflows: def.workflows } : {}),
    ...(def.agents ? { agents: def.agents } : {}),
    ...(def.connections ? { connectionIds: idsOf(def.connections) } : {}),
    ...(def.knowledge ? { knowledgeIds: idsOf(def.knowledge) } : {}),
    ...(def.variables ? { variableIds: idsOf(def.variables) } : {}),
    ...(def.objects ? { objectIds: idsOf(def.objects) } : {}),
    ...(def.objectTypes ? { objectTypeIds: idsOf(def.objectTypes) } : {}),
    ...(def.mcpServers ? { mcpServers: def.mcpServers } : {}),
    ...(def.a2aAgents ? { a2aAgentIds: idsOf(def.a2aAgents) } : {}),
    codeSource: 'synced',
    ...syncFields(options),
  };
}

export class AgentsResource {
  constructor(private readonly http: HttpClient) {}

  /** Lists agents visible to the caller in the current workspace. */
  list(options?: ListQueryOptions): Promise<Agent[]> {
    return this.http.get<Agent[]>('/api/agents', {
      query: serializeListQuery(options),
    });
  }

  /** Returns a single agent. */
  get(agentId: string, options?: Pick<ListQueryOptions, 'expansion'>): Promise<Agent> {
    return this.http.get<Agent>(`/api/agents/${agentId}`, {
      query: serializeListQuery(options),
    });
  }

  /** Exported definition for `lunnoa/agents/<slug>.json`. */
  getDefinition(slug: string): Promise<CodeDefinitionResponse<AgentFileDefinition>> {
    return this.http.get<CodeDefinitionResponse<AgentFileDefinition>>(
      `/api/agents/slug/${encodeURIComponent(slug)}/definition`,
    );
  }

  /**
   * Upsert an agent by slug inside the workspace on the API key.
   * Prefer the CLI (`npx @lunnoa/client agents deploy`) for happy-path deploy.
   */
  upsertBySlug(
    body: UpsertAgentBySlugInput | AgentDefinition | AgentFileDefinition,
    options?: AgentUpsertOptions,
  ): Promise<Agent & CodeDefinitionResponse<AgentFileDefinition>> {
    const payload =
      'kind' in body && body.kind === 'agent'
        ? agentDefinitionToUpsert(body, options)
        : body;
    return this.http.post<Agent & CodeDefinitionResponse<AgentFileDefinition>>(
      '/api/agents/upsert',
      { body: payload },
    );
  }
}
