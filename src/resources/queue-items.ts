import type { HttpClient } from '../core/http';
import { iterateOffset, type OffsetPagination } from '../core/pagination';
import type {
  BulkCreateQueueItemsInput,
  BulkCreateQueueItemsResult,
  CreateQueueItemInput,
  QueueItem,
  QueueItemCreated,
  QueueItemErrorEntry,
  QueueItemFull,
  QueueItemList,
  QueueItemStats,
  UpdateQueueItemInput,
} from '../types';

export type QueueItemStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'SUCCESS'
  | 'FAILED'
  | 'RETRYING';

export interface AddQueueItemErrorInput {
  /** Error message recorded on the item. */
  error: string;
  /**
   * Extra details. An object is sent as a JSON string, which is what the
   * server validates.
   */
  errorDetails?: string | Record<string, unknown>;
}
import { serializeCsv, serializeFilterBy } from './common';

export interface ListQueueItemsOptions {
  limit?: number;
  offset?: number;
  expansion?: string | string[];
  /** Supports keys including `status`, `externalId`, `objectId`, `priority`. */
  filterBy?: string | Record<string, string>;
}

export interface ListQueueItemsByObjectOptions {
  status?: string;
  limit?: number;
  offset?: number;
  expansion?: string | string[];
}

export class QueueItemsResource {
  constructor(private readonly http: HttpClient) {}

  /** Returns one page of items in a queue (offset-based pagination). */
  list(
    queueId: string,
    options: ListQueueItemsOptions = {},
  ): Promise<QueueItemList> {
    return this.http.get<QueueItemList>(`/api/queues/${queueId}/items`, {
      query: {
        limit: options.limit,
        offset: options.offset,
        expansion: serializeCsv(options.expansion),
        filterBy: serializeFilterBy(options.filterBy),
      },
    });
  }

  /** Async-iterates every item in a queue, fetching batches lazily. */
  iterate(
    queueId: string,
    options: Omit<ListQueueItemsOptions, 'offset'> = {},
  ): AsyncGenerator<QueueItem, void, undefined> {
    return iterateOffset<QueueItem>(async (offset) => {
      const result = await this.list(queueId, { ...options, offset });
      return {
        items: result.items ?? [],
        pagination: result.pagination as unknown as OffsetPagination,
      };
    });
  }

  /** Returns a single queue item. */
  get(queueId: string, itemId: string): Promise<QueueItemFull> {
    return this.http.get<QueueItemFull>(
      `/api/queues/${queueId}/items/${itemId}`,
    );
  }

  /** Adds an item to a queue. Pass `objectId` to link the item to an entity. */
  create(
    queueId: string,
    data: CreateQueueItemInput,
  ): Promise<QueueItemCreated> {
    return this.http.post<QueueItemCreated>(`/api/queues/${queueId}/items`, {
      body: data,
    });
  }

  /**
   * Lists queue items linked to an Object across all queues in the workspace.
   * Use for Object detail "Work" panels.
   */
  listByObject(
    objectId: string,
    options: ListQueueItemsByObjectOptions = {},
  ): Promise<QueueItemList> {
    return this.http.get<QueueItemList>(
      `/api/objects/${objectId}/queue-items`,
      {
        query: {
          status: options.status,
          limit: options.limit,
          offset: options.offset,
          expansion: serializeCsv(options.expansion),
        },
      },
    );
  }

  /** Async-iterates every queue item linked to an Object. */
  iterateByObject(
    objectId: string,
    options: Omit<ListQueueItemsByObjectOptions, 'offset'> = {},
  ): AsyncGenerator<QueueItem, void, undefined> {
    return iterateOffset<QueueItem>(async (offset) => {
      const result = await this.listByObject(objectId, {
        ...options,
        offset,
      });
      return {
        items: result.items ?? [],
        pagination: result.pagination as unknown as OffsetPagination,
      };
    });
  }

  /** Adds many items to a queue in one call. */
  bulkCreate(
    queueId: string,
    data: BulkCreateQueueItemsInput,
  ): Promise<BulkCreateQueueItemsResult> {
    return this.http.post<BulkCreateQueueItemsResult>(
      `/api/queues/${queueId}/items/bulk`,
      { body: data },
    );
  }

  /** Updates a queue item. */
  update(
    queueId: string,
    itemId: string,
    data: UpdateQueueItemInput,
  ): Promise<QueueItem> {
    return this.http.patch<QueueItem>(
      `/api/queues/${queueId}/items/${itemId}`,
      { body: data },
    );
  }

  /** Deletes a queue item. */
  delete(queueId: string, itemId: string): Promise<{ success: boolean }> {
    return this.http.delete<{ success: boolean }>(
      `/api/queues/${queueId}/items/${itemId}`,
    );
  }

  /** Returns items that are ready to be processed. */
  listReady(queueId: string, options: { limit?: number } = {}): Promise<QueueItem[]> {
    return this.http.get<QueueItem[]>(`/api/queues/${queueId}/items/ready`, {
      query: { limit: options.limit },
    });
  }

  /** Returns items eligible for retry. */
  listRetryable(queueId: string): Promise<QueueItem[]> {
    return this.http.get<QueueItem[]>(`/api/queues/${queueId}/items/retry`);
  }

  /** Returns a page of items with the given status. */
  listByStatus(
    queueId: string,
    status: QueueItemStatus,
    options: { limit?: number; offset?: number } = {},
  ): Promise<QueueItemList> {
    return this.http.get<QueueItemList>(
      `/api/queues/${queueId}/items/status/${status}`,
      { query: { limit: options.limit, offset: options.offset } },
    );
  }

  /** Looks an item up by the external ID your system supplied. */
  getByExternalId(queueId: string, externalId: string): Promise<QueueItemFull> {
    return this.http.get<QueueItemFull>(
      `/api/queues/${queueId}/items/external/${externalId}`,
    );
  }

  /**
   * Searches items by external id, item data, and metadata.
   * Returns one page, same shape as `list`.
   */
  search(
    queueId: string,
    query: string,
    options: Omit<ListQueueItemsOptions, 'filterBy'> = {},
  ): Promise<QueueItemList> {
    return this.http.get<QueueItemList>(
      `/api/queues/${queueId}/items/search`,
      {
        query: {
          limit: options.limit,
          offset: options.offset,
          expansion: serializeCsv(options.expansion),
          filterBy: serializeFilterBy({ search: query }),
        },
      },
    );
  }

  /** Returns per-status and per-priority counts for the queue. */
  stats(queueId: string): Promise<QueueItemStats> {
    return this.http.get<QueueItemStats>(`/api/queues/${queueId}/items/stats`);
  }

  /** Returns the recorded processing errors of an item. */
  listErrors(queueId: string, itemId: string): Promise<QueueItemErrorEntry[]> {
    return this.http.get<QueueItemErrorEntry[]>(
      `/api/queues/${queueId}/items/${itemId}/errors`,
    );
  }

  /** Updates the processing status of an item. */
  updateStatus(
    queueId: string,
    itemId: string,
    status: string,
  ): Promise<QueueItem> {
    return this.http.patch<QueueItem>(
      `/api/queues/${queueId}/items/${itemId}/status`,
      { body: { status } },
    );
  }

  /** Links an item to the workflow execution that processed it. */
  linkExecution(
    queueId: string,
    itemId: string,
    executionId: string,
  ): Promise<QueueItem> {
    return this.http.patch<QueueItem>(
      `/api/queues/${queueId}/items/${itemId}/link-execution`,
      { body: { executionId } },
    );
  }

  /** Queues the item for another processing attempt. */
  retry(queueId: string, itemId: string): Promise<QueueItem> {
    return this.http.post<QueueItem>(
      `/api/queues/${queueId}/items/${itemId}/retry`,
    );
  }

  /** Records a processing error on the item. */
  addError(
    queueId: string,
    itemId: string,
    error: AddQueueItemErrorInput,
  ): Promise<QueueItem> {
    return this.http.post<QueueItem>(
      `/api/queues/${queueId}/items/${itemId}/error`,
      {
        body: {
          error: error.error,
          errorDetails: serializeErrorDetails(error.errorDetails),
        },
      },
    );
  }
}

function serializeErrorDetails(
  value: string | Record<string, unknown> | undefined,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return typeof value === 'string' ? value : JSON.stringify(value);
}
