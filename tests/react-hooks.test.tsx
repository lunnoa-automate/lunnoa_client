/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createBrowserClient,
  createMemoryTokenStore,
  type ExecutionProgress,
} from '../src';
import {
  LunnoaAuthProvider,
  useApprovalsInbox,
  useEntityList,
  useExecutionProgress,
  useNeedsInput,
} from '../src/react';
import { FAKE_JWT } from './fixtures';

function seededClient(fetchImpl: ReturnType<typeof vi.fn>) {
  const tokenStore = createMemoryTokenStore({ accessToken: FAKE_JWT });
  return createBrowserClient({
    baseUrl: 'https://lunnoa.example',
    tokenStore,
    fetch: fetchImpl as typeof fetch,
  });
}

function wrapperFor(client: ReturnType<typeof createBrowserClient>) {
  return ({ children }: { children: ReactNode }) =>
    createElement(LunnoaAuthProvider, { client, children });
}

function withMe(handlers: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  return vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/api/users/me')) {
      return Response.json({
        id: 'u1',
        email: 'ada@example.com',
        name: 'Ada',
      });
    }
    return handlers(url, init);
  });
}

function sseStream(chunks: string[]): Response {
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
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe('useExecutionProgress', () => {
  it('stays idle when executionId is null', async () => {
    const client = seededClient(
      withMe(() => {
        throw new Error('unexpected');
      }),
    );

    const { result } = renderHook(() => useExecutionProgress(null), {
      wrapper: wrapperFor(client),
    });

    await waitFor(() => {
      expect(result.current.status).toBe('idle');
    });
    expect(result.current.progress).toBeNull();
  });

  it('subscribes via watchProgress and finishes on terminal snapshot', async () => {
    const fetchImpl = withMe(async (url) => {
      if (url.includes('/stream')) {
        return sseStream([
          'event: execution.progress\ndata: {"executionId":"ex-1","status":"RUNNING","statusMessage":null,"name":null,"source":"SDK","executionPath":[{"nodeId":"n1","label":"Step","appId":"http","status":"RUNNING"}]}\n\n',
          'event: execution.finished\ndata: {"executionId":"ex-1","status":"SUCCESS"}\n\n',
        ]);
      }
      if (url.includes('/api/executions/ex-1')) {
        return Response.json({
          id: 'ex-1',
          status: 'SUCCESS',
          statusMessage: null,
          source: 'SDK',
          name: 'Done',
          startedAt: '2026-07-15T10:00:00.000Z',
          executionPath: [
            {
              nodeId: 'n1',
              label: 'Step',
              appId: 'http',
              status: 'SUCCESS',
            },
          ],
        });
      }
      if (url.includes('/api/workflow-apps')) {
        return Response.json([]);
      }
      throw new Error(`Unexpected fetch ${url}`);
    });

    const client = seededClient(fetchImpl);
    const { result } = renderHook(() => useExecutionProgress('ex-1'), {
      wrapper: wrapperFor(client),
    });

    await waitFor(() => {
      expect(result.current.status).toBe('finished');
    });
    expect(result.current.progress?.executionId).toBe('ex-1');
    expect(result.current.progress?.status).toBe('SUCCESS');
  });

  it('refresh fetches a one-shot getProgress snapshot', async () => {
    const fetchImpl = withMe(async (url) => {
      if (url.includes('/stream')) {
        return new Response(
          new ReadableStream({
            start() {
              /* never close */
            },
          }),
          { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
        );
      }
      if (url.includes('/api/executions/ex-2') && !url.includes('/stream')) {
        return Response.json({
          id: 'ex-2',
          status: 'RUNNING',
          executionPath: [
            {
              nodeId: 'n1',
              label: 'Step',
              appId: 'http',
              status: 'RUNNING',
            },
          ],
        });
      }
      if (url.includes('/api/workflow-apps')) {
        return Response.json([]);
      }
      throw new Error(`Unexpected fetch ${url}`);
    });

    const client = seededClient(fetchImpl);
    const { result } = renderHook(() => useExecutionProgress('ex-2'), {
      wrapper: wrapperFor(client),
    });

    await act(async () => {
      const snapshot = await result.current.refresh();
      expect(snapshot?.executionId).toBe('ex-2');
    });
    expect(result.current.progress?.status).toBe('RUNNING');
  });
});

describe('useNeedsInput', () => {
  it('derives waiting step and submits input', async () => {
    const fetchImpl = withMe(async (url, init) => {
      if (url.includes('/input') && init?.method === 'POST') {
        return Response.json({ ok: true });
      }
      throw new Error(`Unexpected fetch ${url}`);
    });

    const client = seededClient(fetchImpl);

    const progress: ExecutionProgress = {
      executionId: 'ex-3',
      status: 'NEEDS_INPUT',
      steps: [
        {
          nodeId: 'wait-1',
          label: 'Approve',
          appId: 'core',
          status: 'NEEDS_INPUT',
        },
      ],
      pendingInput: [
        {
          nodeId: 'wait-1',
          label: 'Approve',
          fields: [
            {
              id: 'comment',
              label: 'Comment',
              inputType: 'text',
              required: false,
            },
          ],
        },
      ],
      activeStepIndex: 0,
    };

    const onSubmitted = vi.fn();
    const { result } = renderHook(
      () => useNeedsInput(progress, { onSubmitted }),
      { wrapper: wrapperFor(client) },
    );

    expect(result.current.waiting).toBe(true);
    expect(result.current.nodeId).toBe('wait-1');
    expect(result.current.pendingInput?.fields[0]?.id).toBe('comment');

    await act(async () => {
      await result.current.submitInput({ comment: 'Looks good' });
    });

    expect(onSubmitted).toHaveBeenCalledOnce();
    const inputCall = fetchImpl.mock.calls.find(([url]) =>
      String(url).includes('/input'),
    );
    expect(inputCall).toBeTruthy();
    expect(String(inputCall![0])).toContain(
      '/api/webhooks/executions/ex-3/nodes/wait-1/input',
    );
  });

  it('handles null source gracefully', async () => {
    const client = seededClient(
      withMe(() => {
        throw new Error('unexpected');
      }),
    );

    const { result } = renderHook(() => useNeedsInput(null), {
      wrapper: wrapperFor(client),
    });

    expect(result.current.waiting).toBe(false);
    expect(result.current.pendingInput).toBeNull();
    await expect(result.current.submitInput({})).rejects.toThrow(
      /waiting for input/,
    );
  });
});

describe('useApprovalsInbox', () => {
  it('loads inbox and refreshes after decide', async () => {
    let inboxCalls = 0;
    const fetchImpl = withMe(async (url, init) => {
      if (url.includes('/api/approvals/inbox')) {
        inboxCalls += 1;
        return Response.json({
          items:
            inboxCalls === 1
              ? [
                  {
                    approvalId: 'ap-1',
                    executionId: 'ex-1',
                    nodeId: 'n1',
                    title: 'Approve spend',
                    status: 'pending',
                    requiredCount: 1,
                    receivedApprovals: 0,
                  },
                ]
              : [],
        });
      }
      if (url.includes('/decide') && init?.method === 'POST') {
        return Response.json({
          executionId: 'ex-1',
          nodeId: 'n1',
          terminal: true,
          canDecide: false,
          approval: {},
        });
      }
      throw new Error(`Unexpected fetch ${url}`);
    });

    const client = seededClient(fetchImpl);
    const { result } = renderHook(() => useApprovalsInbox(), {
      wrapper: wrapperFor(client),
    });

    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });
    expect(result.current.items).toHaveLength(1);

    await act(async () => {
      await result.current.decide('ap-1', { decision: 'approved' });
    });

    await waitFor(() => {
      expect(result.current.items).toHaveLength(0);
    });
  });
});

describe('useEntityList', () => {
  it('fetches a page and updates on setPage', async () => {
    const fetchImpl = withMe(async (url) => {
      const parsed = new URL(url);
      const page = Number(parsed.searchParams.get('page') ?? '1');
      return Response.json({
        data: [
          {
            id: `e-${page}`,
            name: `Entity ${page}`,
            objectTypeId: 'ot-1',
          },
        ],
        pagination: {
          page,
          pageSize: 20,
          totalCount: 40,
          totalPages: 2,
        },
      });
    });

    const client = seededClient(fetchImpl);
    const { result } = renderHook(
      () =>
        useEntityList({
          objectTypeSlug: 'invoice',
          expansion: ['attributes'],
        }),
      { wrapper: wrapperFor(client) },
    );

    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });
    expect(result.current.data[0]?.id).toBe('e-1');
    expect(result.current.pagination?.totalPages).toBe(2);

    await act(async () => {
      result.current.setPage(2);
    });

    await waitFor(() => {
      expect(result.current.data[0]?.id).toBe('e-2');
    });
    expect(result.current.page).toBe(2);
  });
});
