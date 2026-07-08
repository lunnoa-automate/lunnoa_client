import { describe, expect, it } from 'vitest';

import { parseSseStream } from '../src/streaming/sse';

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

async function collect(stream: ReadableStream<Uint8Array>): Promise<string[]> {
  const out: string[] = [];
  for await (const data of parseSseStream(stream)) {
    out.push(data);
  }
  return out;
}

describe('parseSseStream', () => {
  it('parses simple data events', async () => {
    const events = await collect(
      streamFromChunks(['data: {"type":"start"}\n\ndata: {"type":"finish"}\n\n']),
    );
    expect(events).toEqual(['{"type":"start"}', '{"type":"finish"}']);
  });

  it('reassembles events split across arbitrary chunk boundaries', async () => {
    const payload = 'data: {"type":"text-delta","id":"t1","delta":"Hello world"}\n\n';
    // Split mid-line and mid-delimiter.
    const chunks = [payload.slice(0, 7), payload.slice(7, 30), payload.slice(30, payload.length - 1), payload.slice(payload.length - 1)];
    const events = await collect(streamFromChunks(chunks));
    expect(events).toEqual(['{"type":"text-delta","id":"t1","delta":"Hello world"}']);
  });

  it('ignores keep-alive comment lines (": ")', async () => {
    const events = await collect(
      streamFromChunks([':\n\n', 'data: {"a":1}\n\n', ':keep-alive\n\n']),
    );
    expect(events).toEqual(['{"a":1}']);
  });

  it('handles CRLF line endings', async () => {
    const events = await collect(
      streamFromChunks(['data: {"a":1}\r\n\r\ndata: {"b":2}\r\n\r\n']),
    );
    expect(events).toEqual(['{"a":1}', '{"b":2}']);
  });

  it('joins multi-line data fields with newline', async () => {
    const events = await collect(
      streamFromChunks(['data: line1\ndata: line2\n\n']),
    );
    expect(events).toEqual(['line1\nline2']);
  });

  it('flushes a trailing event without final delimiter', async () => {
    const events = await collect(streamFromChunks(['data: {"tail":true}']));
    expect(events).toEqual(['{"tail":true}']);
  });

  it('yields [DONE] terminators verbatim (filtering is the caller responsibility)', async () => {
    const events = await collect(
      streamFromChunks(['data: {"a":1}\n\ndata: [DONE]\n\n']),
    );
    expect(events).toEqual(['{"a":1}', '[DONE]']);
  });
});
