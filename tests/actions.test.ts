import { describe, expect, it, vi } from 'vitest';

import { HttpClient } from '../src/core/http';
import { ActionsResource } from '../src/resources/actions';
import { ExecutionsResource } from '../src/resources/executions';
import { FAKE_API_KEY } from './fixtures';

describe('actions.run', () => {
  it('POSTs /api/actions/run with the request body', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(_input)).toBe('https://lunnoa.example/api/actions/run');
      expect(init?.method).toBe('POST');
      expect(JSON.parse(String(init?.body))).toEqual({
        appId: 'http',
        actionId: 'http_action_send-request',
        input: { method: 'GET', url: 'https://example.com' },
        name: 'Ping example',
      });
      return new Response(
        JSON.stringify({
          id: 'exec-sdk-1',
          status: 'SUCCESS',
          statusMessage: 'Ran successfully',
          output: { statusCode: 200 },
          executionPath: [
            { nodeId: 'n1', label: 'Ping example', status: 'SUCCESS' },
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
    const actions = new ActionsResource(http, new ExecutionsResource(http));

    const result = await actions.run({
      appId: 'http',
      actionId: 'http_action_send-request',
      input: { method: 'GET', url: 'https://example.com' },
      name: 'Ping example',
    });

    expect(result.id).toBe('exec-sdk-1');
    expect(result.status).toBe('SUCCESS');
    expect(result.output).toEqual({ statusCode: 200 });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('runAndWait polls executions until finished', async () => {
    let calls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls += 1;
      if (url.endsWith('/api/actions/run')) {
        return new Response(
          JSON.stringify({ id: 'exec-sdk-2', status: 'SUCCESS' }),
          { status: 201, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({
          id: 'exec-sdk-2',
          status: 'SUCCESS',
          executionPath: [{ nodeId: 'n1', label: 'Step', status: 'SUCCESS' }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });

    const http = new HttpClient({
      baseUrl: 'https://lunnoa.example',
      apiKey: FAKE_API_KEY,
      fetch: fetchMock,
    });
    const actions = new ActionsResource(http, new ExecutionsResource(http));

    const execution = await actions.runAndWait(
      {
        appId: 'http',
        actionId: 'http_action_send-request',
        input: { method: 'GET', url: 'https://example.com' },
      },
      { sleep: async () => undefined },
    );

    expect(execution.status).toBe('SUCCESS');
    expect(calls).toBeGreaterThanOrEqual(2);
  });
});
