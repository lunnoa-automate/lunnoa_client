import type { HttpClient } from '../core/http';
import type {
  AvailableContextBlueprint,
  ContextBlueprint,
  ContextBlueprintDetail,
} from '../types';

export class ContextBlueprintsResource {
  constructor(private readonly http: HttpClient) {}

  /** Lists all context blueprints available in the workspace. */
  listAvailable(): Promise<AvailableContextBlueprint[]> {
    return this.http.get<AvailableContextBlueprint[]>(
      '/api/context-blueprints/available',
    );
  }

  /** Lists context blueprints defined for one entity type. */
  list(objectTypeId: string): Promise<ContextBlueprint[]> {
    return this.http.get<ContextBlueprint[]>('/api/context-blueprints', {
      query: { objectTypeId },
    });
  }

  /** Returns a single context blueprint with its full definition. */
  get(id: string): Promise<ContextBlueprintDetail> {
    return this.http.get<ContextBlueprintDetail>(
      `/api/context-blueprints/${id}`,
    );
  }
}
