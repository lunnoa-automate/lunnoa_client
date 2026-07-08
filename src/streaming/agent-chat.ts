import type { UIMessage, UIMessageChunk } from 'ai';

import type { HttpClient } from '../core/http';
import { parseSseStream } from './sse';

export type ChatMode = 'builder' | 'preview';

export interface StreamMessageOptions {
  /** Agent chat mode; defaults to the server default (`builder`). */
  chatMode?: ChatMode;
  /** Abort the stream (closes the HTTP connection; the run keeps going server-side — call `stop` to cancel it). */
  signal?: AbortSignal;
}

export interface StopStreamOptions {
  /**
   * Partial assistant message (AI SDK UIMessage) received so far; the server
   * persists it so the partial turn is not lost.
   */
  assistantMessage?: UIMessage;
}

/**
 * An in-flight agent chat turn, exposed as an async iterable of AI SDK
 * `UIMessageChunk`s (`text-delta`, `tool-*`, `finish`, ...).
 *
 * ```ts
 * const stream = await client.agentChat.streamMessage(agentId, taskId, message);
 * for await (const chunk of stream) {
 *   if (chunk.type === 'text-delta') process.stdout.write(chunk.delta);
 * }
 * ```
 *
 * Use {@link AgentChatStream.toUIMessageStream} with the AI SDK's
 * `readUIMessageStream` to consume assembled `UIMessage` snapshots instead of
 * raw chunks.
 */
export class AgentChatStream implements AsyncIterable<UIMessageChunk> {
  /**
   * Server run id of this turn (`X-Task-Run-Id` response header), when
   * provided. Useful for diagnostics.
   */
  readonly runId: string | null;

  private consumed = false;

  constructor(
    private readonly response: Response,
    private readonly options?: { signal?: AbortSignal },
  ) {
    this.runId = response.headers.get('X-Task-Run-Id');
  }

  [Symbol.asyncIterator](): AsyncGenerator<UIMessageChunk, void, undefined> {
    return this.chunks();
  }

  async *chunks(): AsyncGenerator<UIMessageChunk, void, undefined> {
    if (this.consumed) {
      throw new Error('This AgentChatStream has already been consumed.');
    }
    this.consumed = true;

    const body = this.response.body;
    if (!body) {
      return;
    }

    for await (const data of parseSseStream(body)) {
      if (this.options?.signal?.aborted) {
        return;
      }
      if (data === '[DONE]') {
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(data);
      } catch {
        continue; // Skip malformed events rather than killing the stream.
      }
      if (parsed && typeof parsed === 'object' && 'type' in parsed) {
        yield parsed as UIMessageChunk;
      }
    }
  }

  /**
   * The same chunks as a web `ReadableStream`, ready for the AI SDK's
   * `readUIMessageStream({ stream })` to assemble into `UIMessage` snapshots.
   */
  toUIMessageStream(): ReadableStream<UIMessageChunk> {
    const iterator = this.chunks();
    return new ReadableStream<UIMessageChunk>({
      async pull(controller) {
        const { done, value } = await iterator.next();
        if (done) {
          controller.close();
        } else {
          controller.enqueue(value);
        }
      },
      async cancel() {
        await iterator.return();
      },
    });
  }

  /** Collects the full text of the turn (concatenated `text-delta` chunks). */
  async text(): Promise<string> {
    let text = '';
    for await (const chunk of this.chunks()) {
      if (chunk.type === 'text-delta' && typeof chunk.delta === 'string') {
        text += chunk.delta;
      }
    }
    return text;
  }
}

/**
 * Hand-written client for the Agent Runtime SSE endpoints
 * (`POST/GET /api/agents/:agentId/tasks/:taskId/stream-message` and `/stop`).
 * Code generators handle SSE poorly, so this module wraps the wire protocol
 * the bundled UI uses (AI SDK UIMessage chunks, SSE-framed, resumable).
 */
export class AgentChatClient {
  constructor(private readonly http: HttpClient) {}

  /**
   * Sends a user message to an agent task and streams the assistant turn.
   * Creates the task row when `taskId` does not exist yet (client-generated
   * UUIDs are supported, mirroring the bundled UI).
   *
   * `message` may be a plain string (wrapped into a UIMessage) or a full AI
   * SDK `UIMessage`.
   */
  async streamMessage(
    agentId: string,
    taskId: string,
    message: string | UIMessage,
    options: StreamMessageOptions = {},
  ): Promise<AgentChatStream> {
    const uiMessage: UIMessage =
      typeof message === 'string'
        ? {
            id: generateMessageId(),
            role: 'user',
            parts: [{ type: 'text', text: message }],
          }
        : message;

    const response = await this.http.request<Response>(
      'POST',
      `/api/agents/${agentId}/tasks/${taskId}/stream-message`,
      {
        raw: true,
        signal: options.signal,
        headers: { Accept: 'text/event-stream' },
        body: {
          messages: [uiMessage],
          ...(options.chatMode ? { chatMode: options.chatMode } : {}),
        },
      },
    );

    return new AgentChatStream(response, { signal: options.signal });
  }

  /**
   * Reattaches to an in-flight agent turn after a disconnect (the resumable
   * stream replays from the beginning of the turn). Returns `null` when
   * there is no active stream to resume (server responds 204).
   */
  async resumeStream(
    agentId: string,
    taskId: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<AgentChatStream | null> {
    const response = await this.http.request<Response>(
      'GET',
      `/api/agents/${agentId}/tasks/${taskId}/stream-message`,
      {
        raw: true,
        signal: options.signal,
        headers: { Accept: 'text/event-stream' },
      },
    );

    if (response.status === 204) {
      return null;
    }
    return new AgentChatStream(response, { signal: options.signal });
  }

  /**
   * Requests cancellation of the active agent turn for a task. Idempotent:
   * succeeds even when no stream is active. Optionally persists the partial
   * assistant message received so far.
   */
  async stop(
    agentId: string,
    taskId: string,
    options: StopStreamOptions = {},
  ): Promise<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(
      `/api/agents/${agentId}/tasks/${taskId}/stream-message/stop`,
      {
        body: options.assistantMessage
          ? { assistantMessage: options.assistantMessage }
          : {},
      },
    );
  }
}

function generateMessageId(): string {
  const cryptoObj = globalThis.crypto as Crypto | undefined;
  if (cryptoObj?.randomUUID) {
    return cryptoObj.randomUUID();
  }
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}
