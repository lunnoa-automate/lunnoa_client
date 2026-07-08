import type { HttpClient } from '../core/http';
import type { Agent } from '../types';
import { serializeListQuery, type ListQueryOptions } from './common';

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
}
