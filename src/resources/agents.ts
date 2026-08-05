import type { HttpClient } from '../core/http';
import type { Agent } from '../types';
import type {
  ActionDefinition,
  AgentDefinition,
  AgentToolDefinition,
  WorkflowDefinition,
} from '../define';
import {
  DEFINE_KINDS,
  resolveActionAppId,
  resolveActionId,
} from '../define';
import { serializeListQuery, type ListQueryOptions } from './common';

export interface UpsertAgentToolInput {
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
  description?: string;
  instructions: string;
  model: string;
  aiConnectionId?: string;
  connectionIds?: string[];
  workflowIds?: string[];
  tools?: UpsertAgentToolInput[];
  managedByCode?: boolean;
}

function unwrapTool(
  tool: AgentToolDefinition,
): ActionDefinition | WorkflowDefinition {
  if ('use' in tool && tool.use) {
    return tool.use;
  }
  return tool as ActionDefinition | WorkflowDefinition;
}

export function agentDefinitionToUpsert(
  def: AgentDefinition,
  options?: { workflowIds?: string[] },
): UpsertAgentBySlugInput {
  const tools: UpsertAgentToolInput[] = [];
  const workflowIds = [...(options?.workflowIds ?? [])];

  for (const tool of def.tools ?? []) {
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
    slug: def.slug,
    name: def.name,
    description: def.description,
    instructions: def.instructions,
    model: def.model,
    aiConnectionId: def.aiConnection?.id,
    connectionIds: def.connections
      ?.map((c) => c.id)
      .filter((id): id is string => Boolean(id)),
    workflowIds: workflowIds.length ? workflowIds : undefined,
    tools,
    managedByCode: true,
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

  /**
   * Upsert an agent by project-scoped slug.
   * Prefer the CLI (`npx @lunnoa/client agents deploy`) for happy-path deploy.
   */
  upsertBySlug(
    projectId: string,
    body: UpsertAgentBySlugInput | AgentDefinition,
    options?: { workflowIds?: string[] },
  ): Promise<Agent> {
    const payload =
      'kind' in body && body.kind === 'agent'
        ? agentDefinitionToUpsert(body, options)
        : body;
    return this.http.post<Agent>(`/api/projects/${projectId}/agents/upsert`, {
      body: payload,
    });
  }
}
