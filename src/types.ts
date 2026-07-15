/**
 * Friendly aliases over the OpenAPI-generated component schemas
 * (`src/generated/schema.d.ts`, produced by `npm run codegen:spec`).
 *
 * Regenerate the underlying types whenever the deployment's
 * `openapi.public.json` changes.
 */
import type { components } from './generated/schema';

type Schemas = components['schemas'];

// Discovery
export type EnabledFeatures = Schemas['EnabledFeaturesResponseDto'];

// Projects
export type Project = Schemas['ProjectResponseDto'];
export type CreateProjectInput = Schemas['CreateProjectDto'];

// Agents & tasks
export type Agent = Schemas['AgentResponseDto'];
export type Task = Schemas['TaskResponseDto'];
export type TaskListItem = Schemas['TaskListItemResponseDto'];
export type CreateTaskInput = Schemas['CreateTaskDto'];
export type UpdateTaskInput = Schemas['UpdateTaskDto'];
export type DeletedTask = Schemas['DeletedTaskResponseDto'];
export type MessageTaskInput = Schemas['MessageTaskDto'];

// Workflows & executions
export type Workflow = Schemas['WorkflowResponseDto'];
export type Execution = Schemas['ExecutionResponseDto'];
export type ExecutionPathStep = Schemas['ExecutionPathStepDto'];
export type ExecuteWorkflowResult = Schemas['ExecuteWorkflowResponseDto'];
export type ExecutionStatus = NonNullable<Execution['status']>;

// Entities (objects)
export type Entity = Schemas['ObjectResponseDto'];
export type PaginatedEntities = Schemas['PaginatedObjectsResponseDto'];
export type CreateEntityInput = Schemas['CreateObjectDto'];
export type UpdateEntityInput = Schemas['UpdateObjectDto'];
export type ChangeEntityStateInput = Schemas['ChangeObjectStateDto'];
export type ChangeEntityStateResult = Schemas['ChangeObjectStateResponseDto'];
export type EntityStateHistoryEntry =
  Schemas['ObjectStateHistoryEntryResponseDto'];
export type EntityStateTransitions =
  Schemas['ObjectStateTransitionsResponseDto'];
export type ImportEntitiesResult = Schemas['ImportEntitiesResponseDto'];
export type ImportTemplate = Schemas['ImportTemplateResponseDto'];

// Entity types
export type EntityType = Schemas['ObjectTypeResponseDto'];

// Knowledge
export type Knowledge = Schemas['KnowledgeResponseDto'];
export type CreateKnowledgeInput = Schemas['CreateKnowledgeDto'];
export type UpdateKnowledgeInput = Schemas['UpdateKnowledgeDto'];
export type SaveUploadedTextInput = Schemas['SaveUploadedTextToKnowledgeDto'];
export type KnowledgeDocument = Schemas['KnowledgeDocumentResponseDto'];
export type KnowledgeDocumentGroup =
  Schemas['KnowledgeDocumentGroupResponseDto'];

// Queues
export type Queue = Schemas['QueueResponseDto'];
export type CreateQueueInput = Schemas['CreateQueueDto'];
export type UpdateQueueInput = Schemas['UpdateQueueDto'];
export type QueueStats = Schemas['QueueStatsResponseDto'];

// Queue items
export type QueueItem = Schemas['QueueItemResponseDto'];
export type QueueItemFull = Schemas['QueueItemFullResponseDto'];
export type CreateQueueItemInput = Schemas['CreateQueueItemDto'];
export type UpdateQueueItemInput = Schemas['UpdateQueueItemDto'];
export type QueueItemList = Schemas['QueueItemListResponseDto'];
export type QueueItemStats = Schemas['QueueItemStatsResponseDto'];
export type BulkCreateQueueItemsInput = Schemas['BulkCreateQueueItemsDto'];
export type BulkCreateQueueItemsResult =
  Schemas['BulkCreateQueueItemsResponseDto'];
export type QueueItemErrorEntry = Schemas['QueueItemErrorEntryResponseDto'];

// Variables
export type Variable = Schemas['VariableResponseDto'];
export type CreateVariableInput = Schemas['CreateVariableDto'];
export type UpdateVariableInput = Schemas['UpdateVariableDto'];

// Connections
export type Connection = Schemas['ConnectionResponseDto'];

// Workflow apps catalog
export type WorkflowApp = Schemas['WorkflowAppResponseDto'];

export type { components, paths, operations } from './generated/schema';
