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
export { parseSseStream } from './streaming/sse';

export {
  ExecutionTimeoutError,
  ExecutionsResource,
  type WaitUntilFinishedOptions,
} from './resources/executions';
export {
  ApprovalsResource,
  type ApprovalInboxItem,
  type EligibleApprover,
} from './resources/approvals';
export { AgentsResource } from './resources/agents';
export { TasksResource } from './resources/tasks';
export { WorkflowsResource } from './resources/workflows';
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
} from './resources/queue-items';
export { VariablesResource } from './resources/variables';
export { ConnectionsResource } from './resources/connections';
export { ProjectsResource } from './resources/projects';
export { WorkflowAppsResource } from './resources/workflow-apps';
export { DiscoveryResource } from './resources/discovery';
export { type ListQueryOptions } from './resources/common';

export * from './types';

// Re-export the AI SDK message types consumers need for chat.
export type { UIMessage, UIMessageChunk } from 'ai';
