import { describe, expect, it, vi } from 'vitest';

import { HttpClient } from '../src/core/http';
import {
  defineAction,
  defineAgent,
  defineConnection,
  defineTrigger,
  defineWorkflow,
} from '../src/define';
import { AgentsResource } from '../src/resources/agents';
import { ExecutionsResource } from '../src/resources/executions';
import { WorkflowsResource } from '../src/resources/workflows';
import { FAKE_API_KEY } from './fixtures';

describe('upsertBySlug', () => {
  it('workflows.upsertBySlug POSTs /api/workflows/upsert', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe(
        'https://lunnoa.example/api/workflows/upsert',
      );
      expect(init?.method).toBe('POST');
      const body = JSON.parse(String(init?.body));
      expect(body.slug).toBe('ping');
      expect(body.trigger).toBeUndefined();
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
      defineWorkflow({
        slug: 'ping',
        steps: [{ use: defineAction({ id: 'http_action_send-request' }) }],
      }),
    );

    expect(result.id).toBe('wf-1');
  });

  it('sends a catalogue trigger when defineWorkflow has one', async () => {
    let body: Record<string, unknown> = {};
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ id: 'wf-2', name: 'sync' }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const http = new HttpClient({
      baseUrl: 'https://lunnoa.example',
      apiKey: FAKE_API_KEY,
      fetch: fetchMock,
    });
    const workflows = new WorkflowsResource(http, new ExecutionsResource(http));

    await workflows.upsertBySlug(
      defineWorkflow({
        slug: 'sync',
        trigger: defineTrigger({
          id: 'flow-control_trigger_manual',
          inputs: [
            { id: 'invoiceId', label: 'Invoice', inputType: 'text', required: true },
          ],
        }),
        steps: [
          {
            use: defineAction({
              id: 'gmail_action_send-email',
              connection: defineConnection({ id: 'conn-1' }),
            }),
          },
        ],
      }),
    );

    expect(body.trigger).toEqual({
      triggerId: 'flow-control_trigger_manual',
      appId: 'flow-control',
      inputs: [
        { id: 'invoiceId', label: 'Invoice', inputType: 'text', required: true },
      ],
    });
  });

  it('agents.upsertBySlug POSTs /api/agents/upsert', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe(
        'https://lunnoa.example/api/agents/upsert',
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
