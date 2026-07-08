import type { HttpClient } from '../core/http';
import type { Connection } from '../types';
import { serializeListQuery, type ListQueryOptions } from './common';

export class ConnectionsResource {
  constructor(private readonly http: HttpClient) {}

  /** Lists connections in the workspace. */
  list(options?: ListQueryOptions): Promise<Connection[]> {
    return this.http.get<Connection[]>('/api/connections', {
      query: serializeListQuery(options),
    });
  }

  /** Returns a single connection (secrets are never included). */
  get(
    connectionId: string,
    options?: Pick<ListQueryOptions, 'expansion'>,
  ): Promise<Connection> {
    return this.http.get<Connection>(`/api/connections/${connectionId}`, {
      query: serializeListQuery(options),
    });
  }
}
