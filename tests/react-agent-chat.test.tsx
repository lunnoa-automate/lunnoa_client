/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import {
  createBrowserClient,
  createMemoryTokenStore,
} from '../src';
import { LunnoaAuthProvider, useAgentChat } from '../src/react';
import { FAKE_JWT } from './fixtures';

describe('useAgentChat', () => {
  it('generates a stable taskId and exposes send/stop', async () => {
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes('/api/users/me')) {
        return Response.json({
          id: 'u1',
          email: 'ada@example.com',
          name: 'Ada',
        });
      }
      if (url.includes('/stream-message') && !url.includes('/stop')) {
        const encoder = new TextEncoder();
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                'data: {"type":"start","messageId":"m1"}\n\n' +
                  'data: {"type":"text-start","id":"t1"}\n\n' +
                  'data: {"type":"text-delta","id":"t1","delta":"Hi"}\n\n' +
                  'data: {"type":"text-end","id":"t1"}\n\n' +
                  'data: {"type":"finish"}\n\n' +
                  'data: [DONE]\n\n',
              ),
            );
            controller.close();
          },
        });
        return new Response(body, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        });
      }
      if (url.includes('/stop')) {
        return Response.json({ ok: true });
      }
      throw new Error(`Unexpected fetch ${url}`);
    });

    const client = createBrowserClient({
      baseUrl: 'https://lunnoa.example',
      tokenStore: createMemoryTokenStore({ accessToken: FAKE_JWT }),
      fetch: fetchImpl,
    });

    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(LunnoaAuthProvider, { client, children });

    const { result, rerender } = renderHook(() => useAgentChat('agent-1'), {
      wrapper,
    });

    await waitFor(() => {
      expect(result.current.taskId).toBeTruthy();
    });

    const firstTaskId = result.current.taskId;
    rerender();
    expect(result.current.taskId).toBe(firstTaskId);

    await act(async () => {
      await result.current.send('Hello');
    });

    await waitFor(() => {
      const streamCall = fetchImpl.mock.calls.find(
        ([url]) =>
          String(url).includes('/api/agents/agent-1/tasks/') &&
          String(url).includes('/stream-message') &&
          !String(url).includes('/stop'),
      );
      expect(streamCall).toBeTruthy();
      expect(String(streamCall![0])).toContain(firstTaskId);
    });
  });

  it('uses a provided taskId', async () => {
    const client = createBrowserClient({
      baseUrl: 'https://lunnoa.example',
      tokenStore: createMemoryTokenStore({ accessToken: FAKE_JWT }),
      fetch: vi.fn(async (input: string | URL) => {
        if (String(input).includes('/api/users/me')) {
          return Response.json({ id: 'u1', email: 'a@b.c', name: 'A' });
        }
        throw new Error(`Unexpected fetch ${String(input)}`);
      }),
    });

    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(LunnoaAuthProvider, { client, children });

    const { result } = renderHook(
      () => useAgentChat('agent-1', 'fixed-task-id'),
      { wrapper },
    );

    expect(result.current.taskId).toBe('fixed-task-id');
  });
});
