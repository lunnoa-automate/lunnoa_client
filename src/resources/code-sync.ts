import type { HttpClient } from '../core/http';
import type { CodeSyncContext } from '../types';

export class CodeSyncResource {
  constructor(private readonly http: HttpClient) {}

  /** Workspace id and whether synced resources are locked in the UI. */
  context(): Promise<CodeSyncContext> {
    return this.http.get<CodeSyncContext>('/api/code-sync/context');
  }
}
