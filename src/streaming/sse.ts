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

        const data = extractData(rawEvent);
        if (data !== null) {
          yield data;
        }
      }
    }

    // Flush a trailing event without a final blank line (lenient).
    const remaining = buffer.trim();
    if (remaining) {
      const data = extractData(remaining);
      if (data !== null) {
        yield data;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function extractData(rawEvent: string): string | null {
  const dataLines: string[] = [];
  for (const line of rawEvent.split('\n')) {
    if (line.startsWith(':')) {
      continue; // SSE comment (keep-alive)
    }
    if (line.startsWith('data:')) {
      let value = line.slice('data:'.length);
      if (value.startsWith(' ')) {
        value = value.slice(1);
      }
      dataLines.push(value);
    }
  }
  if (dataLines.length === 0) {
    return null;
  }
  return dataLines.join('\n');
}
