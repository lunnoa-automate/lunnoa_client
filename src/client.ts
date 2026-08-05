import { HttpClient, type LunnoaClientOptions } from './core/http';
import { AgentChatClient } from './streaming/agent-chat';
import { ActionsResource } from './resources/actions';
import { AgentsResource } from './resources/agents';
import { AuthResource } from './resources/auth';
import { ConnectionsResource } from './resources/connections';
import { DiscoveryResource } from './resources/discovery';
import { EntitiesResource } from './resources/entities';
import { EntityTypesResource } from './resources/entity-types';
import { ApprovalsResource } from './resources/approvals';
import { ExecutionsResource } from './resources/executions';
import { KnowledgeResource } from './resources/knowledge';
import { ProjectsResource } from './resources/projects';
import { QueueItemsResource } from './resources/queue-items';
import { QueuesResource } from './resources/queues';
import { RunsResource } from './resources/runs';
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
 * import { createBrowserClient } from '@lunnoa/client';
 * const lunnoa = createBrowserClient({ baseUrl: 'https://lunnoa.acme.example' });
 * await lunnoa.auth.login({ email, password });
 * ```
 *
 * Passing an `lna_` API key in a browser throws immediately: API keys are
 * workspace-wide server credentials and must never ship to browsers.
 */
export class LunnoaClient {
  /** The underlying HTTP layer, exposed for advanced/escape-hatch requests. */
  readonly http: HttpClient;

  /** Login, refresh, SSO discovery, and session helpers (Pattern B). */
  readonly auth: AuthResource;
  readonly agents: AgentsResource;
  readonly tasks: TasksResource;
  /** Hand-written SSE streaming client for agent chat (AI SDK UIMessage chunks). */
  readonly agentChat: AgentChatClient;
  readonly workflows: WorkflowsResource;
  readonly executions: ExecutionsResource;
  /** Run catalogue actions as one-step ad-hoc Executions (`source: SDK`). */
  readonly actions: ActionsResource;
  /**
   * Multi-step ad-hoc Executions (`source: SDK`) via `POST /api/runs`.
   * Prefer `defineWorkflow` + `runs.start` for local linear chains.
   */
  readonly runs: RunsResource;
  /** Authenticated Approvals inbox (workspace API). */
  readonly approvals: ApprovalsResource;
  readonly entities: EntitiesResource;
  readonly entityTypes: EntityTypesResource;
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

    this.auth = new AuthResource(this.http, this.http.tokenStore);
    this.agents = new AgentsResource(this.http);
    this.tasks = new TasksResource(this.http);
    this.agentChat = new AgentChatClient(this.http);
    this.workflowApps = new WorkflowAppsResource(this.http);
    this.executions = new ExecutionsResource(this.http, this.workflowApps);
    this.actions = new ActionsResource(this.http, this.executions);
    this.runs = new RunsResource(this.http, this.executions);
    this.approvals = new ApprovalsResource(this.http);
    this.workflows = new WorkflowsResource(this.http, this.executions);
    this.entities = new EntitiesResource(this.http);
    this.entityTypes = new EntityTypesResource(this.http);
    this.knowledge = new KnowledgeResource(this.http);
    this.queues = new QueuesResource(this.http);
    this.queueItems = new QueueItemsResource(this.http);
    this.variables = new VariablesResource(this.http);
    this.connections = new ConnectionsResource(this.http);
    this.projects = new ProjectsResource(this.http);
    this.discovery = new DiscoveryResource(this.http);
  }
}
