import { describe, expect, it, vi } from 'vitest';

import { HttpClient } from '../src/core/http';
import { defineAction, defineWorkflow } from '../src/define';
import { ExecutionsResource } from '../src/resources/executions';
import { RunsResource } from '../src/resources/runs';
import { FAKE_API_KEY } from './fixtures';

describe('runs.start', () => {
  it('POSTs /api/runs with normalized steps from defineWorkflow', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(_input)).toBe('https://lunnoa.example/api/runs');
      expect(init?.method).toBe('POST');
      expect(JSON.parse(String(init?.body))).toEqual({
        steps: [
          {
            appId: 'http',
            actionId: 'http_action_send-request',
            input: { method: 'GET', url: 'https://example.com' },
          },
        ],
        name: 'ping',
      });
      return new Response(
        JSON.stringify({
          id: 'exec-run-1',
          status: 'SUCCESS',
          output: { statusCode: 200 },
          executionPath: [
            { nodeId: 'n1', label: 'http', status: 'SUCCESS' },
          ],
        }),
        { status: 201, headers: { 'Content-Type': 'application/json' } },
      );
    });

    const http = new HttpClient({
      baseUrl: 'https://lunnoa.example',
      apiKey: FAKE_API_KEY,
      fetch: fetchMock,
    });
    const runs = new RunsResource(http, new ExecutionsResource(http));

    const result = await runs.start(
      defineWorkflow({
        slug: 'ping',
        name: 'ping',
        steps: [
          {
            use: defineAction({
              id: 'http_action_send-request',
              input: { method: 'GET', url: 'https://example.com' },
            }),
          },
        ],
      }),
    );

    expect(result.id).toBe('exec-run-1');
    expect(result.status).toBe('SUCCESS');
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
