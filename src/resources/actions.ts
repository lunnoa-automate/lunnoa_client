import type { HttpClient } from '../core/http';
import type { Execution, RunActionResult } from '../types';
import type {
  ExecutionsResource,
  WaitUntilFinishedOptions,
} from './executions';

export interface RunActionOptions {
  /** Workflow app id (catalogue slug), e.g. `http`, `gmail`. */
  appId: string;
  /** Action id within the app, e.g. `http_action_send-request`. */
  actionId: string;
  /**
   * Connection instance UUID (`Connection.id`). Required when the action needs
   * a connection and the workspace has more than one for the app. When omitted
   * and exactly one connection exists, the platform uses that connection.
   */
  connectionId?: string;
  /**
   * Project UUID for variable/project scoping. Required when the workspace has
   * more than one project.
   */
  projectId?: string;
  /** Action input fields (keys from the action `inputConfig`). */
  input?: Record<string, unknown>;
  /** Optional display name for the ad-hoc Execution. */
  name?: string;
}

export class ActionsResource {
  constructor(
    private readonly http: HttpClient,
    private readonly executions: ExecutionsResource,
  ) {}

  /**
   * Run a single catalogue action as a one-step ad-hoc Execution (`source: SDK`).
   *
   * The platform runs the action synchronously and returns the execution id
   * plus status/output/executionPath. You can also poll
   * {@link ExecutionsResource.get} / {@link ExecutionsResource.waitUntilFinished}
   * with the returned id.
   *
   * Discover `appId` / `actionId` / `inputConfig` via `workflowApps.list()`.
   */
  run(options: RunActionOptions): Promise<RunActionResult> {
    return this.http.post<RunActionResult>('/api/actions/run', {
      body: options,
    });
  }

  /**
   * Convenience: run the action and wait until the Execution reaches a
   * terminal status (or pauses in `NEEDS_INPUT`). Prefer {@link run} when the
   * synchronous response is enough.
   */
  async runAndWait(
    options: RunActionOptions,
    waitOptions?: WaitUntilFinishedOptions,
  ): Promise<Execution> {
    const { id } = await this.run(options);
    return this.executions.waitUntilFinished(id, {
      ...waitOptions,
      expansion: [
        'executionPath',
        'source',
        ...(waitOptions?.expansion ?? []),
      ],
    });
  }

  /**
   * Thin discovery helper: find one action definition from `workflowApps.list()`.
   * Prefer calling `workflowApps.list()` once and caching when looking up many
   * actions.
   */
  async get(
    appId: string,
    actionId: string,
  ): Promise<Record<string, unknown> | undefined> {
    const apps = await this.http.get<
      Array<{
        id?: string;
        actions?: Array<Record<string, unknown>>;
      }>
    >('/api/workflow-apps');
    const app = apps.find((a) => a.id === appId);
    return app?.actions?.find((action) => action.id === actionId);
  }
}
