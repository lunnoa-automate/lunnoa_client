import { describe, expect, it, vi } from 'vitest';

import { HttpClient } from '../src/core/http';
import { EntitiesResource } from '../src/resources/entities';
import { QueueItemsResource } from '../src/resources/queue-items';
import { TasksResource } from '../src/resources/tasks';
import { FAKE_API_KEY } from './fixtures';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function client(fetchMock: typeof fetch) {
  return new HttpClient({
    baseUrl: 'https://lunnoa.example',
    apiKey: FAKE_API_KEY,
    fetch: fetchMock,
  });
}

describe('queue item calls that drifted from Automate', () => {
  it('searches with filterBy=search and returns the page', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe('/api/queues/q1/items/search');
      expect(url.searchParams.get('q')).toBeNull();
      expect(url.searchParams.get('filterBy')).toBe('search:acme');
      expect(url.searchParams.get('limit')).toBe('10');
      return jsonResponse({
        items: [{ id: 'item-1' }],
        pagination: { total: 1, limit: 10, offset: 0, hasMore: false },
      });
    });

    const page = await new QueueItemsResource(client(fetchMock)).search(
      'q1',
      'acme',
      { limit: 10 },
    );
    expect(page.items).toEqual([{ id: 'item-1' }]);
    expect(page.pagination?.total).toBe(1);
  });

  it('lists by status as a page', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe('/api/queues/q1/items/status/FAILED');
      expect(url.searchParams.get('offset')).toBe('20');
      return jsonResponse({
        items: [],
        pagination: { total: 0, limit: 25, offset: 20, hasMore: false },
      });
    });

    const page = await new QueueItemsResource(client(fetchMock)).listByStatus(
      'q1',
      'FAILED',
      { offset: 20 },
    );
    expect(page.items).toEqual([]);
  });

  it('records an error with the error field and JSON-string details', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(_input)).toBe(
        'https://lunnoa.example/api/queues/q1/items/item-1/error',
      );
      expect(JSON.parse(String(init?.body))).toEqual({
        error: 'timed out',
        errorDetails: '{"code":"ETIMEDOUT"}',
      });
      return jsonResponse({ id: 'item-1', status: 'FAILED' }, 201);
    });

    const item = await new QueueItemsResource(client(fetchMock)).addError(
      'q1',
      'item-1',
      { error: 'timed out', errorDetails: { code: 'ETIMEDOUT' } },
    );
    expect(item.id).toBe('item-1');
  });
});

describe('entity list query', () => {
  it('sends type, state, and name search only', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe('/api/objects');
      expect(url.searchParams.get('objectTypeSlug')).toBe('invoice');
      expect(url.searchParams.get('search')).toBe('acme');
      expect(url.searchParams.has('ownerId')).toBe(false);
      return jsonResponse({
        data: [],
        pagination: { page: 1, pageSize: 25, totalCount: 0, totalPages: 0 },
      });
    });

    await new EntitiesResource(client(fetchMock)).list({
      objectTypeSlug: 'invoice',
      search: 'acme',
    });
  });
});

describe('task message body', () => {
  it('sends piiResolution and drops solution handoff fields', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.chatMode).toBe('preview');
      expect(body.piiResolution).toBe('anonymize');
      expect(body.data).toEqual({ imageUrl: 'https://example.com/a.png' });
      expect(body).not.toHaveProperty('solutionId');
      expect(body.messages).toHaveLength(1);
      return jsonResponse('ok');
    });

    await new TasksResource(client(fetchMock)).message('agent-1', 'task-1', 'hello', {
      chatMode: 'preview',
      piiResolution: 'anonymize',
      data: { imageUrl: 'https://example.com/a.png' },
    });
  });
});
