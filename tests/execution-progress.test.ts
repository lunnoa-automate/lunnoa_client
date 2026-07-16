import { describe, expect, it, vi } from 'vitest';

import { LunnoaClient } from '../src/client';
import { parseSseEvents } from '../src/streaming/sse';
import { FAKE_API_KEY } from './fixtures';

function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

describe('parseSseEvents', () => {
  it('preserves named event types', async () => {
    const frames: Array<{ event: string; data: string | null }> = [];
    for await (const frame of parseSseEvents(
      streamFromChunks([
        'event: execution.progress\ndata: {"status":"RUNNING"}\n\n',
        'event: heartbeat\ndata: {"ts":"1"}\n\n',
      ]),
    )) {
      frames.push(frame);
    }
    expect(frames).toEqual([
      { event: 'execution.progress', data: '{"status":"RUNNING"}' },
      { event: 'heartbeat', data: '{"ts":"1"}' },
    ]);
  });
});

describe('executions.getProgress / watchProgress', () => {
  it('getProgress enriches steps with catalogue icons', async () => {
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes('/api/executions/') && !url.includes('/stream')) {
        return Response.json({
          id: 'ex-1',
          status: 'RUNNING',
          statusMessage: null,
          source: 'SDK',
          name: 'Demo',
          startedAt: '2026-07-15T10:00:00.000Z',
          executionPath: [
            {
              nodeId: 'n1',
              label: 'Send request',
              appId: 'http',
              actionId: 'http_action_send-request',
              status: 'RUNNING',
              startTime: '2026-07-15T10:00:00.000Z',
            },
          ],
        });
      }
      if (url.includes('/api/workflow-apps')) {
        return Response.json([
          {
            id: 'http',
            name: 'HTTP',
            description: '',
            logoUrl: 'https://cdn.example/http.svg',
            isPublished: true,
            needsConnection: false,
            availableForAgent: true,
            actions: [
              {
                id: 'http_action_send-request',
                name: 'Send request',
                iconUrl: 'https://cdn.example/send.svg',
              },
            ],
            triggers: [],
            connections: [],
          },
        ]);
      }
      throw new Error(`Unexpected fetch ${url}`);
    });

    const lunnoa = new LunnoaClient({
      baseUrl: 'https://lunnoa.example',
      apiKey: FAKE_API_KEY,
      fetch: fetchImpl,
    });

    const progress = await lunnoa.executions.getProgress('ex-1');
    expect(progress.executionId).toBe('ex-1');
    expect(progress.activeStepIndex).toBe(0);
    expect(progress.steps[0]?.appLogoUrl).toBe('https://cdn.example/http.svg');
    expect(progress.steps[0]?.iconUrl).toBe('https://cdn.example/send.svg');
  });

  it('watchProgress yields enriched snapshots until finished', async () => {
    const encoder = new TextEncoder();
    const sse = [
      'event: connected\ndata: {"executionId":"ex-1"}\n\n',
      'event: execution.progress\ndata: {"executionId":"ex-1","status":"RUNNING","statusMessage":null,"name":null,"source":"SDK","executionPath":[{"nodeId":"n1","label":"Step","appId":"http","status":"RUNNING"}]}\n\n',
      'event: execution.progress\ndata: {"executionId":"ex-1","status":"SUCCESS","statusMessage":null,"name":null,"source":"SDK","executionPath":[{"nodeId":"n1","label":"Step","appId":"http","status":"SUCCESS","startTime":"2026-07-15T10:00:00.000Z","endTime":"2026-07-15T10:00:01.000Z"}]}\n\n',
      'event: execution.finished\ndata: {"executionId":"ex-1","status":"SUCCESS"}\n\n',
    ].join('');

    const fetchImpl = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes('/stream')) {
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(encoder.encode(sse));
              controller.close();
            },
          }),
          { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
        );
      }
      if (url.includes('/api/executions/') && !url.includes('/stream')) {
        return Response.json({
          id: 'ex-1',
          status: 'SUCCESS',
          executionPath: [
            {
              nodeId: 'n1',
              label: 'Step',
              appId: 'http',
              status: 'SUCCESS',
              startTime: '2026-07-15T10:00:00.000Z',
              endTime: '2026-07-15T10:00:01.000Z',
            },
          ],
        });
      }
      if (url.includes('/api/workflow-apps')) {
        return Response.json([]);
      }
      throw new Error(`Unexpected fetch ${url}`);
    });

    const lunnoa = new LunnoaClient({
      baseUrl: 'https://lunnoa.example',
      apiKey: FAKE_API_KEY,
      fetch: fetchImpl,
    });

    const snapshots = [];
    for await (const snap of lunnoa.executions.watchProgress('ex-1')) {
      snapshots.push(snap);
    }
    expect(snapshots.length).toBeGreaterThanOrEqual(2);
    expect(snapshots[0]?.status).toBe('RUNNING');
    expect(snapshots.at(-1)?.status).toBe('SUCCESS');
    expect(snapshots.at(-1)?.steps[0]?.durationMs).toBe(1000);
  });
});
