import type { HttpClient } from '../core/http';

export interface AiConnectionModel {
  /** Catalogue id for `defineAgent({ model })`. */
  id: string;
  name: string;
  isDefault: boolean;
  supportsTools: boolean;
  supportsVision: boolean;
  supportsReasoning: boolean;
}

export interface AiConnection {
  /** AiProviderConnection UUID for `defineAiConnection({ id })`. */
  id: string;
  name: string;
  /** Provider slug, for example `featherless` or `openai`. */
  provider: string;
  /** True when agent deploy uses this connection if `aiConnection` is omitted. */
  isDefault: boolean;
  models: AiConnectionModel[];
}

export class AiConnectionsResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * Lists AI connections the caller can assign to an agent, with the model
   * ids each connection accepts. Credentials are never included.
   * Requires `agents:create` (the same permission as agent deploy).
   */
  list(): Promise<AiConnection[]> {
    return this.http.get<AiConnection[]>('/api/ai-connections');
  }
}
