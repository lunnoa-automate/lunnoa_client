import { describe, expect, it, vi } from 'vitest';

import { HttpClient } from '../src/core/http';
import { defineAction, defineAgent, defineWorkflow } from '../src/define';
import { AgentsResource } from '../src/resources/agents';
import { ExecutionsResource } from '../src/resources/executions';
import { WorkflowsResource } from '../src/resources/workflows';
import { FAKE_API_KEY } from './fixtures';

describe('upsertBySlug', () => {
  it('workflows.upsertBySlug POSTs the project upsert route', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe(
        'https://lunnoa.example/api/projects/proj-1/workflows/upsert',
      );
      expect(init?.method).toBe('POST');
      const body = JSON.parse(String(init?.body));
      expect(body.slug).toBe('ping');
      expect(body.steps[0].actionId).toBe('http_action_send-request');
      return new Response(
        JSON.stringify({ id: 'wf-1', name: 'ping', slug: 'ping' }),
        { status: 201, headers: { 'Content-Type': 'application/json' } },
      );
    });

    const http = new HttpClient({
      baseUrl: 'https://lunnoa.example',
      apiKey: FAKE_API_KEY,
      fetch: fetchMock,
    });
    const workflows = new WorkflowsResource(
      http,
      new ExecutionsResource(http),
    );

    const result = await workflows.upsertBySlug(
      'proj-1',
      defineWorkflow({
        slug: 'ping',
        steps: [{ use: defineAction({ id: 'http_action_send-request' }) }],
      }),
    );

    expect(result.id).toBe('wf-1');
  });

  it('agents.upsertBySlug POSTs the project upsert route', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe(
        'https://lunnoa.example/api/projects/proj-1/agents/upsert',
      );
      const body = JSON.parse(String(init?.body));
      expect(body.slug).toBe('triage');
      expect(body.model).toBe('gpt-4o');
      expect(body.tools).toHaveLength(1);
      return new Response(
        JSON.stringify({ id: 'ag-1', name: 'triage', slug: 'triage' }),
        { status: 201, headers: { 'Content-Type': 'application/json' } },
      );
    });

    const http = new HttpClient({
      baseUrl: 'https://lunnoa.example',
      apiKey: FAKE_API_KEY,
      fetch: fetchMock,
    });
    const agents = new AgentsResource(http);

    const result = await agents.upsertBySlug(
      'proj-1',
      defineAgent({
        slug: 'triage',
        model: 'gpt-4o',
        instructions: 'Help.',
        tools: [defineAction({ id: 'http_action_send-request' })],
      }),
    );

    expect(result.id).toBe('ag-1');
  });
});
