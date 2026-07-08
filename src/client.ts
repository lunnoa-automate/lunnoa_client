import { HttpClient, type LunnoaClientOptions } from './core/http';
import { AgentChatClient } from './streaming/agent-chat';
import { AgentsResource } from './resources/agents';
import { ConnectionsResource } from './resources/connections';
import { ContextBlueprintsResource } from './resources/context-blueprints';
import { DiscoveryResource } from './resources/discovery';
import { EntitiesResource } from './resources/entities';
import { EntityTypesResource } from './resources/entity-types';
import { ExecutionsResource } from './resources/executions';
import { KnowledgeResource } from './resources/knowledge';
import { ProjectsResource } from './resources/projects';
import { QueueItemsResource } from './resources/queue-items';
import { QueuesResource } from './resources/queues';
import { TasksResource } from './resources/tasks';
import { VariablesResource } from './resources/variables';
import { WorkflowAppsResource } from './resources/workflow-apps';
import { WorkflowsResource } from './resources/workflows';

/**
 * Typed client for the Lunnoa Automate Public API.
 *
 * Server-side (Pattern A — the backend holds the key):
 * ```ts
 * const lunnoa = new LunnoaClient({
 *   baseUrl: 'https://lunnoa.acme.example',
 *   apiKey: process.env.LUNNOA_API_KEY, // lna_...
 * });
 * ```
 *
 * Browser (Pattern B — the end user is a Lunnoa user):
 * ```ts
 * const lunnoa = new LunnoaClient({
 *   baseUrl: 'https://lunnoa.acme.example',
 *   accessToken: () => localStorage.getItem('accessToken')!,
 * });
 * ```
 *
 * Passing an `lna_` API key in a browser throws immediately: API keys are
 * workspace-wide server credentials and must never ship to browsers.
 */
export class LunnoaClient {
  /** The underlying HTTP layer, exposed for advanced/escape-hatch requests. */
  readonly http: HttpClient;

  readonly agents: AgentsResource;
  readonly tasks: TasksResource;
  /** Hand-written SSE streaming client for agent chat (AI SDK UIMessage chunks). */
  readonly agentChat: AgentChatClient;
  readonly workflows: WorkflowsResource;
  readonly executions: ExecutionsResource;
  readonly entities: EntitiesResource;
  readonly entityTypes: EntityTypesResource;
  readonly contextBlueprints: ContextBlueprintsResource;
  readonly knowledge: KnowledgeResource;
  readonly queues: QueuesResource;
  readonly queueItems: QueueItemsResource;
  readonly variables: VariablesResource;
  readonly connections: ConnectionsResource;
  readonly projects: ProjectsResource;
  readonly workflowApps: WorkflowAppsResource;
  readonly discovery: DiscoveryResource;

  constructor(options: LunnoaClientOptions) {
    this.http = new HttpClient(options);

    this.agents = new AgentsResource(this.http);
    this.tasks = new TasksResource(this.http);
    this.agentChat = new AgentChatClient(this.http);
    this.executions = new ExecutionsResource(this.http);
    this.workflows = new WorkflowsResource(this.http, this.executions);
    this.entities = new EntitiesResource(this.http);
    this.entityTypes = new EntityTypesResource(this.http);
    this.contextBlueprints = new ContextBlueprintsResource(this.http);
    this.knowledge = new KnowledgeResource(this.http);
    this.queues = new QueuesResource(this.http);
    this.queueItems = new QueueItemsResource(this.http);
    this.variables = new VariablesResource(this.http);
    this.connections = new ConnectionsResource(this.http);
    this.projects = new ProjectsResource(this.http);
    this.workflowApps = new WorkflowAppsResource(this.http);
    this.discovery = new DiscoveryResource(this.http);
  }
}
