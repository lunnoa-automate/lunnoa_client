import { describe, expect, it } from 'vitest';

import { HttpClient } from '../src/core/http';
import { AgentChatClient, AgentChatStream } from '../src/streaming/agent-chat';
import { FAKE_API_KEY } from './fixtures';

/**
 * Synthetic recording of the wire format the server produces: AI SDK
 * UIMessage chunks, SSE-framed, with keep-alive comments and a [DONE]
 * terminator — the same shape `pipeStringSseStream` writes in
 * packages/server/src/modules/core/tasks/tasks.controller.ts.
 */
const RECORDED_TURN = [
  'data: {"type":"start","messageId":"msg-1"}\n\n',
  'data: {"type":"start-step"}\n\n',
  'data: {"type":"text-start","id":"txt-1"}\n\n',
  ':\n\n', // keep-alive ping
  'data: {"type":"text-delta","id":"txt-1","delta":"Hello"}\n\n',
  'data: {"type":"text-delta","id":"txt-1","delta":" from"}\n\n',
  'data: {"type":"text-delta","id":"txt-1","delta":" Lunnoa"}\n\n',
  'data: {"type":"text-end","id":"txt-1"}\n\n',
  'data: {"type":"finish-step"}\n\n',
  'data: {"type":"finish"}\n\n',
  'data: [DONE]\n\n',
];

function sseResponse(chunks: string[], headers: Record<string, string> = {}): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream', ...headers },
  });
}

describe('AgentChatStream', () => {
  it('yields UIMessage chunks and stops at [DONE]', async () => {
    const stream = new AgentChatStream(sseResponse(RECORDED_TURN));
    const chunkTypes: string[] = [];
    for await (const chunk of stream) {
      chunkTypes.push(chunk.type);
    }
    expect(chunkTypes).toEqual([
      'start',
      'start-step',
      'text-start',
      'text-delta',
      'text-delta',
      'text-delta',
      'text-end',
      'finish-step',
      'finish',
    ]);
  });

  it('collects the full turn text', async () => {
    const stream = new AgentChatStream(sseResponse(RECORDED_TURN));
    expect(await stream.text()).toBe('Hello from Lunnoa');
  });

  it('skips malformed events instead of failing the stream', async () => {
    const stream = new AgentChatStream(
      sseResponse([
        'data: {"type":"start"}\n\n',
        'data: {not json}\n\n',
        'data: {"type":"finish"}\n\n',
      ]),
    );
    const types: string[] = [];
    for await (const chunk of stream) {
      types.push(chunk.type);
    }
    expect(types).toEqual(['start', 'finish']);
  });

  it('exposes the run id from the X-Task-Run-Id header', () => {
    const stream = new AgentChatStream(
      sseResponse([], { 'X-Task-Run-Id': 'run-42' }),
    );
    expect(stream.runId).toBe('run-42');
  });

  it('refuses double consumption', async () => {
    const stream = new AgentChatStream(sseResponse(RECORDED_TURN));
    await stream.text();
    await expect(stream.text()).rejects.toThrow(/already been consumed/);
  });

  it('toUIMessageStream produces a readable stream of the same chunks', async () => {
    const stream = new AgentChatStream(sseResponse(RECORDED_TURN));
    const reader = stream.toUIMessageStream().getReader();
    const types: string[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      types.push(value.type);
    }
    expect(types[0]).toBe('start');
    expect(types.at(-1)).toBe('finish');
  });
});

describe('AgentChatClient', () => {
  it('POSTs the message in AI SDK UIMessage format and parses the SSE reply', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = async (url: string | URL, init?: RequestInit) => {
      requests.push({ url: String(url), init });
      return sseResponse(RECORDED_TURN, { 'X-Task-Run-Id': 'run-1' });
    };

    const http = new HttpClient({
      baseUrl: 'https://lunnoa.example',
      apiKey: FAKE_API_KEY,
      fetch: fetchImpl,
    });
    const chat = new AgentChatClient(http);

    const stream = await chat.streamMessage('agent-1', 'task-1', 'Hi there');
    expect(stream.runId).toBe('run-1');
    expect(await stream.text()).toBe('Hello from Lunnoa');

    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe(
      'https://lunnoa.example/api/agents/agent-1/tasks/task-1/stream-message',
    );
    const body = JSON.parse(String(requests[0].init?.body));
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].role).toBe('user');
    expect(body.messages[0].parts).toEqual([{ type: 'text', text: 'Hi there' }]);
    expect(typeof body.messages[0].id).toBe('string');
  });

  it('resumeStream returns null on 204 (nothing to resume)', async () => {
    const http = new HttpClient({
      baseUrl: 'https://lunnoa.example',
      apiKey: FAKE_API_KEY,
      fetch: async () => new Response(null, { status: 204 }),
    });
    const chat = new AgentChatClient(http);
    expect(await chat.resumeStream('agent-1', 'task-1')).toBeNull();
  });

  it('stop posts the partial assistant message', async () => {
    let capturedBody: unknown;
    const http = new HttpClient({
      baseUrl: 'https://lunnoa.example',
      apiKey: FAKE_API_KEY,
      fetch: async (_url, init) => {
        capturedBody = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ ok: true }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    });
    const chat = new AgentChatClient(http);
    const result = await chat.stop('agent-1', 'task-1', {
      assistantMessage: {
        id: 'm1',
        role: 'assistant',
        parts: [{ type: 'text', text: 'partial' }],
      },
    });
    expect(result).toEqual({ ok: true });
    expect(capturedBody).toEqual({
      assistantMessage: {
        id: 'm1',
        role: 'assistant',
        parts: [{ type: 'text', text: 'partial' }],
      },
    });
  });
});
