import { describe, expect, it } from 'vitest';

import { HttpClient } from '../src/core/http';
import {
  ExecutionTimeoutError,
  ExecutionsResource,
} from '../src/resources/executions';
import { FAKE_API_KEY } from './fixtures';

function makeExecutionsResource(statuses: Array<string | undefined>): {
  executions: ExecutionsResource;
  polls: () => number;
  delays: number[];
} {
  let pollCount = 0;
  const delays: number[] = [];
  const http = new HttpClient({
    baseUrl: 'https://lunnoa.example',
    apiKey: FAKE_API_KEY,
    fetch: async () => {
      const status = statuses[Math.min(pollCount, statuses.length - 1)];
      pollCount += 1;
      return new Response(JSON.stringify({ id: 'exec-1', status }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });
  const executions = new ExecutionsResource(http);
  return { executions, polls: () => pollCount, delays };
}

const instantSleep = (delays: number[]) => async (ms: number) => {
  delays.push(ms);
};

describe('executions.waitUntilFinished', () => {
  it('resolves once the execution reaches SUCCESS', async () => {
    const { executions, polls, delays } = makeExecutionsResource([
      'RUNNING',
      'RUNNING',
      'SUCCESS',
    ]);
    const result = await executions.waitUntilFinished('exec-1', {
      sleep: instantSleep(delays),
    });
    expect(result.status).toBe('SUCCESS');
    expect(polls()).toBe(3);
  });

  it('applies exponential backoff capped at maxDelayMs', async () => {
    const { executions, delays } = makeExecutionsResource([
      'RUNNING',
      'RUNNING',
      'RUNNING',
      'RUNNING',
      'RUNNING',
      'SUCCESS',
    ]);
    await executions.waitUntilFinished('exec-1', {
      initialDelayMs: 100,
      backoffFactor: 2,
      maxDelayMs: 500,
      sleep: instantSleep(delays),
    });
    expect(delays).toEqual([100, 200, 400, 500, 500]);
  });

  it('stops on NEEDS_INPUT by default', async () => {
    const { executions, polls, delays } = makeExecutionsResource([
      'RUNNING',
      'NEEDS_INPUT',
    ]);
    const result = await executions.waitUntilFinished('exec-1', {
      sleep: instantSleep(delays),
    });
    expect(result.status).toBe('NEEDS_INPUT');
    expect(polls()).toBe(2);
  });

  it('keeps polling through NEEDS_INPUT when stopOnNeedsInput is false', async () => {
    const { executions, delays } = makeExecutionsResource([
      'NEEDS_INPUT',
      'RUNNING',
      'FAILED',
    ]);
    const result = await executions.waitUntilFinished('exec-1', {
      stopOnNeedsInput: false,
      sleep: instantSleep(delays),
    });
    expect(result.status).toBe('FAILED');
  });

  it('resolves for FAILED and CANCELLED (terminal statuses)', async () => {
    for (const terminal of ['FAILED', 'CANCELLED']) {
      const { executions, delays } = makeExecutionsResource(['RUNNING', terminal]);
      const result = await executions.waitUntilFinished('exec-1', {
        sleep: instantSleep(delays),
      });
      expect(result.status).toBe(terminal);
    }
  });

  it('throws ExecutionTimeoutError when the budget is exhausted', async () => {
    const { executions, delays } = makeExecutionsResource(['RUNNING']);
    await expect(
      executions.waitUntilFinished('exec-1', {
        timeoutMs: 1_000,
        initialDelayMs: 400,
        backoffFactor: 2,
        sleep: instantSleep(delays),
      }),
    ).rejects.toBeInstanceOf(ExecutionTimeoutError);
    // 400 fits (0+400<=1000), 800 would exceed → throws before sleeping it.
    expect(delays).toEqual([400]);
  });
});

describe('executions.submitInput', () => {
  it('POSTs values to the step-input webhook', async () => {
    let captured: { url?: string; body?: unknown } = {};
    const http = new HttpClient({
      baseUrl: 'https://lunnoa.example',
      apiKey: FAKE_API_KEY,
      fetch: async (url, init) => {
        captured = { url: String(url), body: JSON.parse(String(init?.body)) };
        return new Response('OK', { status: 200 });
      },
    });
    const executions = new ExecutionsResource(http);
    await executions.submitInput('exec-1', 'node-7', { approved: true });
    expect(captured.url).toBe(
      'https://lunnoa.example/api/webhooks/executions/exec-1/nodes/node-7/input',
    );
    expect(captured.body).toEqual({ approved: true });
  });
});
