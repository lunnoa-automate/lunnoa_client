import type { HttpClient } from '../core/http';
import type { CreateProjectInput, Project } from '../types';
import { serializeListQuery, type ListQueryOptions } from './common';

export class ProjectsResource {
  constructor(private readonly http: HttpClient) {}

  /** Lists projects in the workspace, most recently updated first. */
  list(options?: ListQueryOptions): Promise<Project[]> {
    return this.http.get<Project[]>('/api/projects', {
      query: serializeListQuery(options),
    });
  }

  /** Returns a single project. */
  get(
    projectId: string,
    options?: Pick<ListQueryOptions, 'expansion'>,
  ): Promise<Project> {
    return this.http.get<Project>(`/api/projects/${projectId}`, {
      query: serializeListQuery(options),
    });
  }

  /** Creates a project. */
  create(data: CreateProjectInput): Promise<Project> {
    return this.http.post<Project>('/api/projects', { body: data });
  }
}
