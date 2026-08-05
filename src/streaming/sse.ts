/**
 * Minimal Server-Sent Events parser.
 *
 * Takes the byte stream of a `text/event-stream` response and yields the
 * `data:` payload of each event. Comment lines (keep-alive `:` pings sent by
 * the Lunnoa server every 15s) and other fields are ignored. Multi-line
 * `data:` fields are joined with `\n` per the SSE specification.
 */
export async function* parseSseStream(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<string, void, undefined> {
  for await (const event of parseSseEvents(stream)) {
    if (event.data !== null) {
      yield event.data;
    }
  }
}

export interface SseEvent {
  /** SSE `event:` field, or `"message"` when omitted. */
  event: string;
  /** Joined `data:` payload, or null when the frame had no data lines. */
  data: string | null;
}

/**
 * Like {@link parseSseStream}, but preserves the SSE event name.
 * Used by execution progress streams (`execution.progress`, `loop.progress`, …).
 */
export async function* parseSseEvents(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<SseEvent, void, undefined> {
  const reader = stream.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: false });
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });

      // Events are separated by a blank line. Normalise CRLF first.
      buffer = buffer.replace(/\r\n/g, '\n');
      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const rawEvent = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf('\n\n');

        const parsed = extractEvent(rawEvent);
        if (parsed.data !== null || parsed.event !== 'message') {
          yield parsed;
        }
      }
    }

    // Flush a trailing event without a final blank line (lenient).
    const remaining = buffer.trim();
    if (remaining) {
      const parsed = extractEvent(remaining);
      if (parsed.data !== null || parsed.event !== 'message') {
        yield parsed;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function extractEvent(rawEvent: string): SseEvent {
  const dataLines: string[] = [];
  let eventName = 'message';

  for (const line of rawEvent.split('\n')) {
    if (line.startsWith(':')) {
      continue; // SSE comment (keep-alive)
    }
    if (line.startsWith('event:')) {
      let value = line.slice('event:'.length);
      if (value.startsWith(' ')) {
        value = value.slice(1);
      }
      if (value) {
        eventName = value;
      }
      continue;
    }
    if (line.startsWith('data:')) {
      let value = line.slice('data:'.length);
      if (value.startsWith(' ')) {
        value = value.slice(1);
      }
      dataLines.push(value);
    }
  }

  return {
    event: eventName,
    data: dataLines.length === 0 ? null : dataLines.join('\n'),
  };
}
