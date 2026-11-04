import { describe, expect, it, vi } from 'vitest';

import { parseArgs } from '../src/cli/args';
import { HttpClient } from '../src/core/http';
import { TablesResource } from '../src/resources/tables';
import { FAKE_API_KEY } from './fixtures';

function tablesWith(fetchMock: typeof fetch) {
  return new TablesResource(
    new HttpClient({ baseUrl: 'https://lunnoa.example', apiKey: FAKE_API_KEY, fetch: fetchMock }),
  );
}

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

describe('tables', () => {
  it('getBySlug hits the slug route', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe('https://lunnoa.example/api/tables/slug/cost_centres');
      return json({ id: 't-1', slug: 'cost_centres', rows: [{ code: 'A1' }] });
    });
    const table = await tablesWith(fetchMock).getBySlug('cost_centres');
    expect(table.rows).toEqual([{ code: 'A1' }]);
  });

  it('upsertBySlug POSTs the upsert route', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://lunnoa.example/api/tables/upsert');
      expect(init?.method).toBe('POST');
      expect(JSON.parse(String(init?.body))).toEqual({ slug: 'cost_centres', rows: [{ code: 'A1' }] });
      return json({ id: 't-1', slug: 'cost_centres', managedByCode: true });
    });
    const table = await tablesWith(fetchMock).upsertBySlug({ slug: 'cost_centres', rows: [{ code: 'A1' }] });
    expect(table.managedByCode).toBe(true);
  });

  it('parses tables get <slug> as a subcommand', () => {
    const args = parseArgs(['tables', 'get', 'cost_centres', '--json']);
    expect(args).toMatchObject({ command: 'tables', subcommand: 'get', path: 'cost_centres', json: true });
  });
});
