import type { HttpClient } from '../core/http';
import type { WorkflowApp } from '../types';

/**
 * Read-only catalog of workflow apps and their actions/triggers. Custom UIs
 * use it to resolve `executionPath` step `appId`/`actionId` pairs to
 * human-readable names and icons, and to read the declarative
 * `ActionUIDefinition` metadata for rendering rich action outputs.
 */
export class WorkflowAppsResource {
  constructor(private readonly http: HttpClient) {}

  /** Lists all workflow apps installed on the deployment. */
  list(): Promise<WorkflowApp[]> {
    return this.http.get<WorkflowApp[]>('/api/workflow-apps');
  }

  /**
   * Creates a connection for an app where the connection type is
   * non-interactive (API key, basic auth). OAuth connections require the
   * browser flow inside the bundled UI and cannot be created here.
   */
  connect(
    appId: string,
    connectionId: string,
    value: Record<string, unknown>,
  ): Promise<unknown> {
    return this.http.post<unknown>(
      `/api/workflow-apps/${appId}/connections/${connectionId}/connect`,
      { body: value },
    );
  }
}
