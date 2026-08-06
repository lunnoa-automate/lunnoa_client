import type { EntityTypeDefinition as DefineEntityTypeDefinition } from '../define';
import type { HttpClient } from '../core/http';
import type { EntityType } from '../types';
import { serializeCsv } from './common';

export interface EntityTypeReadOptions {
  /** Fields to expand, e.g. `['attributeSchema', 'stateSchema', 'description']`. */
  expansion?: string | string[];
}

/** Payload for `POST /api/object-types/upsert`. */
export interface UpsertEntityTypeBySlugInput {
  slug: string;
  name?: string;
  namePlural?: string;
  description?: string;
  icon?: string;
  color?: string;
  attributeSchema: Record<string, unknown>;
  stateSchema?: Record<string, unknown> | null;
  isEnabled?: boolean;
  allowUnknownAttributes?: boolean;
  managedByCode?: boolean;
}

export function entityTypeDefinitionToUpsert(
  def: DefineEntityTypeDefinition,
): UpsertEntityTypeBySlugInput {
  return {
    slug: def.slug,
    name: def.name,
    namePlural: def.namePlural,
    description: def.description,
    icon: def.icon,
    color: def.color,
    attributeSchema: def.attributeSchema,
    stateSchema: def.stateSchema,
    isEnabled: def.isEnabled,
    allowUnknownAttributes: def.allowUnknownAttributes ?? false,
    managedByCode: true,
  };
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

  /**
   * Creates or updates an entity type by workspace-scoped slug.
   * Prefer the CLI (`npx @lunnoa/client entity-types deploy`) for happy-path deploy.
   */
  upsertBySlug(
    definition: DefineEntityTypeDefinition | UpsertEntityTypeBySlugInput,
  ): Promise<EntityType> {
    const payload =
      'kind' in definition && definition.kind === 'entityType'
        ? entityTypeDefinitionToUpsert(definition)
        : (definition as UpsertEntityTypeBySlugInput);

    return this.http.post<EntityType>('/api/object-types/upsert', {
      body: payload,
      query: {
        expansion: 'attributeSchema,stateSchema,description',
      },
    });
  }
}
