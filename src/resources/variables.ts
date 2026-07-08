import type { HttpClient } from '../core/http';
import type {
  CreateVariableInput,
  UpdateVariableInput,
  Variable,
} from '../types';
import { serializeListQuery, type ListQueryOptions } from './common';

export class VariablesResource {
  constructor(private readonly http: HttpClient) {}

  /** Lists variables in the workspace. */
  list(options?: ListQueryOptions): Promise<Variable[]> {
    return this.http.get<Variable[]>('/api/variables', {
      query: serializeListQuery(options),
    });
  }

  /** Returns a single variable. */
  get(
    variableId: string,
    options?: Pick<ListQueryOptions, 'expansion'>,
  ): Promise<Variable> {
    return this.http.get<Variable>(`/api/variables/${variableId}`, {
      query: serializeListQuery(options),
    });
  }

  /** Creates a variable. */
  create(data: CreateVariableInput): Promise<Variable> {
    return this.http.post<Variable>('/api/variables', { body: data });
  }

  /** Updates a variable. */
  update(variableId: string, data: UpdateVariableInput): Promise<Variable> {
    return this.http.patch<Variable>(`/api/variables/${variableId}`, {
      body: data,
    });
  }

  /** Deletes a variable. */
  delete(variableId: string): Promise<boolean> {
    return this.http.delete<boolean>(`/api/variables/${variableId}`);
  }
}
