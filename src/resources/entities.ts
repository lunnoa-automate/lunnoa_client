import type { HttpClient, QueryValue } from '../core/http';
import { iteratePages } from '../core/pagination';
import type {
  ChangeEntityStateInput,
  ChangeEntityStateResult,
  CreateEntityInput,
  Entity,
  EntityStateHistoryEntry,
  EntityStateTransitions,
  ImportEntitiesResult,
  ImportTemplate,
  PaginatedEntities,
  UpdateEntityInput,
} from '../types';
import { serializeCsv } from './common';

export interface ListEntitiesOptions {
  /** Filter by entity type ID. */
  objectTypeId?: string;
  /** Filter by entity type slug (alternative to objectTypeId). */
  objectTypeSlug?: string;
  /** Filter by a single state. */
  state?: string;
  /** Filter by several states (comma-separated server-side). */
  states?: string[];
  /** Filter by owner workspace-user ID. */
  ownerId?: string;
  /** Free-text search over entity names. */
  search?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  /** 1-based page number. */
  page?: number;
  /** Items per page (max 100). */
  pageSize?: number;
  /** Fields to expand, e.g. `['attributes', 'objectType']`. */
  expansion?: string | string[];
}

export interface ImportEntitiesInput {
  entityTypeId: string;
  columnMappings: Array<{
    sourceColumn: string;
    targetFieldId: string;
    transform?: 'none' | 'date' | 'number' | 'boolean';
  }>;
  rows: Array<Record<string, string>>;
  updateExisting?: boolean;
  matchField?: string;
}

export interface ExportEntitiesInput {
  entityTypeId: string;
  fieldIds: string[];
  filters?: Array<{ fieldId: string; operator: string; value: unknown }>;
  format?: 'csv' | 'xlsx';
  includeRelatedEntityNames?: boolean;
}

/**
 * Entities (the platform calls them Objects internally): the structured data
 * layer custom UIs query heavily. Attribute values are keyed by field ID as
 * defined on the entity type's `attributeSchema` — run
 * `npx @lunnoa/client codegen` against your deployment for fully typed,
 * per-entity-type accessors.
 */
export class EntitiesResource {
  constructor(private readonly http: HttpClient) {}

  /** Returns one page of entities matching the filter. */
  list(options: ListEntitiesOptions = {}): Promise<PaginatedEntities> {
    return this.http.get<PaginatedEntities>('/api/objects', {
      query: this.serializeListOptions(options),
    });
  }

  /**
   * Async-iterates every entity matching the filter, fetching pages lazily.
   *
   * ```ts
   * for await (const invoice of client.entities.iterate({ objectTypeSlug: 'invoice' })) { ... }
   * ```
   */
  iterate(
    options: Omit<ListEntitiesOptions, 'page'> = {},
  ): AsyncGenerator<Entity, void, undefined> {
    return iteratePages<Entity>(async (page) => {
      const result = await this.list({ ...options, page });
      return { data: result.data ?? [], pagination: result.pagination };
    });
  }

  /** Returns a single entity. Request `expansion: ['attributes']` for field values. */
  get(
    entityId: string,
    options: { expansion?: string | string[] } = {},
  ): Promise<Entity> {
    return this.http.get<Entity>(`/api/objects/${entityId}`, {
      query: { expansion: serializeCsv(options.expansion) },
    });
  }

  /** Creates an entity. `attributes` are keyed by field ID. */
  create(
    data: CreateEntityInput,
    options: { expansion?: string | string[] } = {},
  ): Promise<Entity> {
    return this.http.post<Entity>('/api/objects', {
      body: data,
      query: { expansion: serializeCsv(options.expansion) },
    });
  }

  /** Partially updates an entity; supplied attributes are merged. */
  update(
    entityId: string,
    data: UpdateEntityInput,
    options: { expansion?: string | string[] } = {},
  ): Promise<Entity> {
    return this.http.patch<Entity>(`/api/objects/${entityId}`, {
      body: data,
      query: { expansion: serializeCsv(options.expansion) },
    });
  }

  /** Soft-deletes an entity. */
  delete(entityId: string): Promise<boolean> {
    return this.http.delete<boolean>(`/api/objects/${entityId}`);
  }

  /** Moves an entity to a new state (validated against the type's state machine). */
  changeState(
    entityId: string,
    data: ChangeEntityStateInput,
  ): Promise<ChangeEntityStateResult> {
    return this.http.post<ChangeEntityStateResult>(
      `/api/objects/${entityId}/state`,
      { body: data },
    );
  }

  /** Returns the entity's state changes, newest first. */
  getStateHistory(
    entityId: string,
    options: { limit?: number } = {},
  ): Promise<EntityStateHistoryEntry[]> {
    return this.http.get<EntityStateHistoryEntry[]>(
      `/api/objects/${entityId}/state/history`,
      { query: { limit: options.limit } },
    );
  }

  /** Returns the current state and the transitions allowed from it. */
  getStateTransitions(entityId: string): Promise<EntityStateTransitions> {
    return this.http.get<EntityStateTransitions>(
      `/api/objects/${entityId}/state/transitions`,
    );
  }

  /** Imports pre-parsed rows into an entity type (SuperAdmin only). */
  import(data: ImportEntitiesInput): Promise<ImportEntitiesResult> {
    return this.http.post<ImportEntitiesResult>('/api/objects/import', {
      body: data,
    });
  }

  /** Exports entities of a type as flat JSON rows. */
  export(data: ExportEntitiesInput): Promise<Array<Record<string, unknown>>> {
    return this.http.post<Array<Record<string, unknown>>>(
      '/api/objects/export',
      { body: data },
    );
  }

  /** Returns the column headers and a sample row for importing (SuperAdmin only). */
  getImportTemplate(entityTypeId: string): Promise<ImportTemplate> {
    return this.http.get<ImportTemplate>(
      `/api/objects/import/template/${entityTypeId}`,
    );
  }

  private serializeListOptions(
    options: ListEntitiesOptions,
  ): Record<string, QueryValue> {
    return {
      objectTypeId: options.objectTypeId,
      objectTypeSlug: options.objectTypeSlug,
      state: options.state,
      states: options.states?.join(','),
      ownerId: options.ownerId,
      search: options.search,
      sortBy: options.sortBy,
      sortOrder: options.sortOrder,
      page: options.page,
      pageSize: options.pageSize,
      expansion: serializeCsv(options.expansion),
    };
  }
}
