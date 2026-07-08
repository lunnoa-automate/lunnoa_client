import type { HttpClient } from '../core/http';
import type { EnabledFeatures } from '../types';

export class DiscoveryResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * Returns the deployment's feature flags (storage, vector database, email,
   * SSO, edition gating), letting a custom UI adapt to what is enabled.
   */
  enabledFeatures(): Promise<EnabledFeatures> {
    return this.http.get<EnabledFeatures>('/api/discovery/enabled-features');
  }
}
