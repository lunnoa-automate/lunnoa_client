import type { HttpClient } from '../core/http';
import type { Table, UpsertTableBySlugInput } from '../types';

export class TablesResource {
  constructor(private readonly http: HttpClient) {}

  /** Lists tables in the API key's workspace (without columns and rows). */
  list(options: { projectId?: string } = {}): Promise<Table[]> {
    return this.http.get<Table[]>('/api/tables', {
      query: { projectId: options.projectId },
    });
  }

  /** Returns a single table by ID, including columns and rows. */
  get(id: string): Promise<Table> {
    return this.http.get<Table>(`/api/tables/${id}`);
  }

  /** Returns a single table by its workspace slug, including columns and rows. */
  getBySlug(slug: string): Promise<Table> {
    return this.http.get<Table>(`/api/tables/slug/${slug}`);
  }

  /**
   * Creates or updates a table by workspace slug. Omitted columns or rows
   * keep their current value. Marks `managedByCode` by default.
   */
  upsertBySlug(input: UpsertTableBySlugInput): Promise<Table> {
    return this.http.post<Table>('/api/tables/upsert', { body: input });
  }
}
