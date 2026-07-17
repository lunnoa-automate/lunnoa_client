export { LunnoaClient } from './client';

export { LunnoaApiError } from './core/errors';
export {
  API_KEY_PREFIX,
  assertApiKeyAllowedInEnvironment,
  isBrowserEnvironment,
} from './core/auth';
export type {
  FetchLike,
  LunnoaClientOptions,
  QueryValue,
  RequestOptions,
} from './core/http';
export { HttpClient } from './core/http';
export {
  iterateOffset,
  iteratePages,
  type OffsetPagination,
  type PagePagination,
} from './core/pagination';

export {
  AgentChatClient,
  AgentChatStream,
  type ChatMode,
  type StopStreamOptions,
  type StreamMessageOptions,
} from './streaming/agent-chat';
export { parseSseStream, parseSseEvents, type SseEvent } from './streaming/sse';
export {
  ExecutionProgressStream,
  type ExecutionProgressPayload,
  type ExecutionStreamEvent,
  type ExecutionStreamEventType,
  type WatchProgressOptions,
} from './streaming/execution-progress';

export {
  ExecutionTimeoutError,
  ExecutionsResource,
  type ExecutionProgress,
  type ExecutionProgressStep,
  type WaitUntilFinishedOptions,
} from './resources/executions';
export {
  ApprovalsResource,
  type ApprovalInboxItem,
  type EligibleApprover,
} from './resources/approvals';
export {
  AuthResource,
  SsoAuthResource,
} from './resources/auth';
export { AgentsResource } from './resources/agents';
export type {
  UpsertAgentBySlugInput,
  UpsertAgentToolInput,
} from './resources/agents';
export { TasksResource } from './resources/tasks';
export { WorkflowsResource } from './resources/workflows';
export type {
  UpsertWorkflowBySlugInput,
  UpsertWorkflowStepInput,
} from './resources/workflows';
export {
  ActionsResource,
  type RunActionOptions,
} from './resources/actions';
export {
  RunsResource,
  type StartRunInput,
  type StartRunOptions,
  type StartRunStep,
} from './resources/runs';
export {
  defineAction,
  defineAgent,
  defineAiConnection,
  defineConnection,
  defineWorkflow,
  DEFINE_KINDS,
  resolveActionAppId,
  resolveActionId,
  type ActionDefinition,
  type AgentDefinition,
  type AgentToolDefinition,
  type AiConnectionDefinition,
  type ConnectionDefinition,
  type DefineKind,
  type WorkflowDefinition,
  type WorkflowStepDefinition,
} from './define';
export {
  EntitiesResource,
  type ExportEntitiesInput,
  type ImportEntitiesInput,
  type ListEntitiesOptions,
} from './resources/entities';
export {
  EntityTypesResource,
  type EntityTypeReadOptions,
} from './resources/entity-types';
export { KnowledgeResource } from './resources/knowledge';
export { QueuesResource } from './resources/queues';
export {
  QueueItemsResource,
  type ListQueueItemsOptions,
  type ListQueueItemsByObjectOptions,
} from './resources/queue-items';
export { VariablesResource } from './resources/variables';
export { ConnectionsResource } from './resources/connections';
export { ProjectsResource } from './resources/projects';
export { WorkflowAppsResource } from './resources/workflow-apps';
export { DiscoveryResource } from './resources/discovery';
export { type ListQueryOptions } from './resources/common';

export {
  createBrowserClient,
  createServerClient,
  createLocalStorageTokenStore,
  createMemoryTokenStore,
  isLoginRequires2FA,
  type AuthTokens,
  type CreateBrowserClientOptions,
  type CreateServerClientOptions,
  type CurrentUser,
  type LocalStorageTokenStoreOptions,
  type LoginRequires2FA,
  type LoginResult,
  type LoginSuccess,
  type SsoProviderSummary,
  type SsoProvidersResponse,
  type TokenStore,
} from './auth';

export * from './types';

// Re-export the AI SDK message types consumers need for chat.
export type { UIMessage, UIMessageChunk } from 'ai';
