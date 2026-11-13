import { HttpClient, type LunnoaClientOptions } from './core/http';
import { AgentChatClient } from './streaming/agent-chat';
import { ActionsResource } from './resources/actions';
import { AgentsResource } from './resources/agents';
import { AuthResource } from './resources/auth';
import { AiConnectionsResource } from './resources/ai-connections';
import { ConnectionsResource } from './resources/connections';
import { DiscoveryResource } from './resources/discovery';
import { EntitiesResource } from './resources/entities';
import { EntityTypesResource } from './resources/entity-types';
import { TablesResource } from './resources/tables';
import { ApprovalsResource } from './resources/approvals';
import { ExecutionsResource } from './resources/executions';
import { KnowledgeResource } from './resources/knowledge';
import { QueueItemsResource } from './resources/queue-items';
import { QueuesResource } from './resources/queues';
import { RunsResource } from './resources/runs';
import { ScorecardsResource } from './resources/scorecards';
import { TasksResource } from './resources/tasks';
import { VariablesResource } from './resources/variables';
import { WorkflowAppsResource } from './resources/workflow-apps';
import { CodeSyncResource } from './resources/code-sync';
import { WorkflowsResource } from './resources/workflows';

/**
 * Typed client for the Lunnoa Automate Public API.
 *
 * Apps sign people in as Lunnoa users:
 * ```ts
 * import { createBrowserClient } from '@lunnoa/client';
 * const lunnoa = createBrowserClient({ baseUrl: 'https://lunnoa.acme.example' });
 * await lunnoa.auth.login({ email, password });
 * ```
 *
 * `apiKey` (`lna_...`) is for the CLI and operator scripts (codegen, discovery,
 * deploy). It is not an app login. Passing one while `window` exists throws:
 * a leaked key acts as that service account across its whole workspace.
 */
export class LunnoaClient {
  /** The underlying HTTP layer, exposed for advanced/escape-hatch requests. */
  readonly http: HttpClient;

  /** Login, refresh, SSO discovery, and session helpers for Lunnoa users. */
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
  /** Small reference / lookup tables (rows stored inline; use entities for transactional data). */
  readonly tables: TablesResource;
  readonly knowledge: KnowledgeResource;
  readonly queues: QueuesResource;
  readonly queueItems: QueueItemsResource;
  readonly variables: VariablesResource;
  readonly scorecards: ScorecardsResource;
  readonly connections: ConnectionsResource;
  /** AI provider connections and the model ids each one accepts. */
  readonly aiConnections: AiConnectionsResource;
  readonly workflowApps: WorkflowAppsResource;
  readonly discovery: DiscoveryResource;
  /** Workspace id for the definitions lock, and the code-sync lock flag. */
  readonly codeSync: CodeSyncResource;

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
    this.tables = new TablesResource(this.http);
    this.knowledge = new KnowledgeResource(this.http);
    this.queues = new QueuesResource(this.http);
    this.queueItems = new QueueItemsResource(this.http);
    this.variables = new VariablesResource(this.http);
    this.scorecards = new ScorecardsResource(this.http);
    this.connections = new ConnectionsResource(this.http);
    this.aiConnections = new AiConnectionsResource(this.http);
    this.discovery = new DiscoveryResource(this.http);
    this.codeSync = new CodeSyncResource(this.http);
  }
}
