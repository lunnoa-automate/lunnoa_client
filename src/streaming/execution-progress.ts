import type { HttpClient } from '../core/http';
import { LunnoaApiError } from '../core/errors';
import { parseSseEvents } from './sse';
import type { ExecutionPathStep, ExecutionStatus } from '../types';

export type ExecutionStreamEventType =
  | 'connected'
  | 'heartbeat'
  | 'execution.progress'
  | 'execution.finished'
  | 'execution.error'
  | 'loop.progress'
  | string;

export interface ExecutionProgressPayload {
  executionId: string;
  status: ExecutionStatus | string | null;
  statusMessage: string | null;
  name: string | null;
  source: string | null;
  startedAt?: string;
  stoppedAt?: string | null;
  executionPath: ExecutionPathStep[];
  pendingInput?: unknown;
  output?: unknown;
}

export interface ExecutionStreamEvent {
  event: ExecutionStreamEventType;
  data: Record<string, unknown>;
}

export interface WatchProgressOptions {
  signal?: AbortSignal;
}

/**
 * Opens `GET /api/executions/:id/stream` and yields typed SSE events.
 * Prefer {@link ExecutionsResource.watchProgress} for timeline UIs.
 */
export class ExecutionProgressStream implements AsyncIterable<ExecutionStreamEvent> {
  private consumed = false;

  constructor(
    private readonly response: Response,
    private readonly options?: WatchProgressOptions,
  ) {}

  [Symbol.asyncIterator](): AsyncGenerator<ExecutionStreamEvent, void, undefined> {
    return this.events();
  }

  async *events(): AsyncGenerator<ExecutionStreamEvent, void, undefined> {
    if (this.consumed) {
      throw new Error('This ExecutionProgressStream has already been consumed.');
    }
    this.consumed = true;

    const body = this.response.body;
    if (!body) {
      return;
    }

    for await (const frame of parseSseEvents(body)) {
      if (this.options?.signal?.aborted) {
        return;
      }
      if (frame.data === null) {
        continue;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(frame.data);
      } catch {
        continue;
      }
      if (!parsed || typeof parsed !== 'object') {
        continue;
      }
      yield {
        event: frame.event,
        data: parsed as Record<string, unknown>,
      };
      if (frame.event === 'execution.finished' || frame.event === 'execution.error') {
        return;
      }
    }
  }
}

export async function openExecutionStream(
  http: HttpClient,
  executionId: string,
  options?: WatchProgressOptions,
): Promise<ExecutionProgressStream> {
  const response = await http.request('GET', `/api/executions/${executionId}/stream`, {
    raw: true,
    signal: options?.signal,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => undefined);
    let parsed: unknown = body;
    try {
      parsed = body ? JSON.parse(body) : undefined;
    } catch {
      // keep text
    }
    throw new LunnoaApiError({
      status: response.status,
      body: parsed,
      method: 'GET',
      path: `/api/executions/${executionId}/stream`,
    });
  }

  return new ExecutionProgressStream(response, options);
}
