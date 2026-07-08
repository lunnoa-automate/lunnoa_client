import type { HttpClient } from '../core/http';
import type {
  CreateQueueInput,
  Queue,
  QueueStats,
  UpdateQueueInput,
} from '../types';
import { serializeListQuery, type ListQueryOptions } from './common';

export class QueuesResource {
  constructor(private readonly http: HttpClient) {}

  /** Lists queues in the workspace, ordered by priority then creation date. */
  list(options?: ListQueryOptions): Promise<Queue[]> {
    return this.http.get<Queue[]>('/api/queues', {
      query: serializeListQuery(options),
    });
  }

  /** Returns a single queue. */
  get(queueId: string, options?: Pick<ListQueryOptions, 'expansion'>): Promise<Queue> {
    return this.http.get<Queue>(`/api/queues/${queueId}`, {
      query: serializeListQuery(options),
    });
  }

  /** Creates a queue. */
  create(data: CreateQueueInput): Promise<Queue> {
    return this.http.post<Queue>('/api/queues', { body: data });
  }

  /** Updates a queue. */
  update(queueId: string, data: UpdateQueueInput): Promise<Queue> {
    return this.http.patch<Queue>(`/api/queues/${queueId}`, { body: data });
  }

  /** Deletes a queue. */
  delete(queueId: string): Promise<{ success: boolean }> {
    return this.http.delete<{ success: boolean }>(`/api/queues/${queueId}`);
  }

  /** Returns aggregate statistics for a queue. */
  stats(queueId: string): Promise<QueueStats> {
    return this.http.get<QueueStats>(`/api/queues/${queueId}/stats`);
  }

  /** Activates a queue. */
  activate(queueId: string): Promise<Queue> {
    return this.http.patch<Queue>(`/api/queues/${queueId}/activate`);
  }

  /** Deactivates a queue. */
  deactivate(queueId: string): Promise<Queue> {
    return this.http.patch<Queue>(`/api/queues/${queueId}/deactivate`);
  }
}
