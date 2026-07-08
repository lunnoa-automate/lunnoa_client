import type { HttpClient } from '../core/http';
import type {
  CreateKnowledgeInput,
  Knowledge,
  KnowledgeDocument,
  KnowledgeDocumentGroup,
  SaveUploadedTextInput,
  UpdateKnowledgeInput,
} from '../types';
import { serializeCsv } from './common';

export class KnowledgeResource {
  constructor(private readonly http: HttpClient) {}

  /** Lists knowledge notebooks in the workspace. */
  list(options: { expansion?: string | string[] } = {}): Promise<Knowledge[]> {
    return this.http.get<Knowledge[]>('/api/knowledge', {
      query: { expansion: serializeCsv(options.expansion) },
    });
  }

  /** Returns a single knowledge notebook. */
  get(
    knowledgeId: string,
    options: { expansion?: string | string[] } = {},
  ): Promise<Knowledge> {
    return this.http.get<Knowledge>(`/api/knowledge/${knowledgeId}`, {
      query: { expansion: serializeCsv(options.expansion) },
    });
  }

  /** Creates a knowledge notebook. Subject to the deployment's storage/vector infrastructure. */
  create(data: CreateKnowledgeInput): Promise<Knowledge> {
    return this.http.post<Knowledge>('/api/knowledge', { body: data });
  }

  /** Updates a knowledge notebook. */
  update(knowledgeId: string, data: UpdateKnowledgeInput): Promise<Knowledge> {
    return this.http.patch<Knowledge>(`/api/knowledge/${knowledgeId}`, {
      body: data,
    });
  }

  /** Deletes a knowledge notebook. */
  delete(knowledgeId: string): Promise<boolean> {
    return this.http.delete<boolean>(`/api/knowledge/${knowledgeId}`);
  }

  /** Saves raw text into the notebook (chunked, embedded, and indexed server-side). */
  saveUploadedText(
    knowledgeId: string,
    data: SaveUploadedTextInput,
  ): Promise<unknown> {
    return this.http.post<unknown>(
      `/api/knowledge/${knowledgeId}/saveUploadedText`,
      { body: data },
    );
  }

  /** Lists the documents stored in a notebook. */
  listDocuments(knowledgeId: string): Promise<KnowledgeDocument[]> {
    return this.http.get<KnowledgeDocument[]>(
      `/api/knowledge/${knowledgeId}/documents`,
    );
  }

  /** Returns one document group (an uploaded document and its chunks). */
  getDocumentGroup(
    knowledgeId: string,
    groupId: string,
  ): Promise<KnowledgeDocumentGroup> {
    return this.http.get<KnowledgeDocumentGroup>(
      `/api/knowledge/${knowledgeId}/documents/${groupId}`,
    );
  }

  /** Deletes one document group from the notebook. */
  deleteDocumentGroup(knowledgeId: string, groupId: string): Promise<boolean> {
    return this.http.delete<boolean>(
      `/api/knowledge/${knowledgeId}/documents/${groupId}`,
    );
  }
}
