import type { HttpClient } from '../core/http';
import type { EntityType } from '../types';
import { serializeCsv } from './common';

export interface EntityTypeReadOptions {
  /** Fields to expand, e.g. `['attributeSchema', 'stateSchema', 'description']`. */
  expansion?: string | string[];
}

export class EntityTypesResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * Lists entity types in the workspace. Request
   * `expansion: ['attributeSchema', 'stateSchema']` for the field and state
   * machine definitions the codegen CLI builds types from.
   */
  list(
    options: EntityTypeReadOptions & { includeDisabled?: boolean } = {},
  ): Promise<EntityType[]> {
    return this.http.get<EntityType[]>('/api/object-types', {
      query: {
        includeDisabled: options.includeDisabled,
        expansion: serializeCsv(options.expansion),
      },
    });
  }

  /** Returns a single entity type by ID. */
  get(id: string, options: EntityTypeReadOptions = {}): Promise<EntityType> {
    return this.http.get<EntityType>(`/api/object-types/${id}`, {
      query: { expansion: serializeCsv(options.expansion) },
    });
  }

  /** Returns a single entity type by its URL-safe slug. */
  getBySlug(
    slug: string,
    options: EntityTypeReadOptions = {},
  ): Promise<EntityType> {
    return this.http.get<EntityType>(`/api/object-types/slug/${slug}`, {
      query: { expansion: serializeCsv(options.expansion) },
    });
  }
}
