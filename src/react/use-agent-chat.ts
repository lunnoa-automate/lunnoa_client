import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage } from 'ai';
import { useCallback, useMemo, useRef, useState } from 'react';

import { useAccessToken, useLunnoaClient } from './auth';

export interface UseAgentChatOptions {
  /** Agent chat mode forwarded in the request body. */
  chatMode?: 'builder' | 'preview';
}

export interface UseAgentChatResult {
  /** Stable task id for this hook lifetime (generated if omitted). */
  taskId: string;
  messages: UIMessage[];
  /** AI SDK chat status (`ready` | `submitted` | `streaming` | `error`). */
  status: string;
  error: Error | undefined;
  /** Sends a plain-text user message. */
  send: (text: string) => Promise<void>;
  /**
   * Aborts the in-flight HTTP stream and asks the server to cancel the turn.
   */
  stop: () => Promise<void>;
}

function createTaskId(): string {
  const cryptoObj = globalThis.crypto as Crypto | undefined;
  if (cryptoObj?.randomUUID) {
    return cryptoObj.randomUUID();
  }
  return `task_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Thin AI SDK wrapper for Lunnoa agent chat.
 *
 * Requires optional peer `@ai-sdk/react` (and the `ai` package already shipped
 * with `@lunnoa/client`). Points `DefaultChatTransport` at the Automate
 * stream-message endpoint with a Bearer token from the auth provider.
 *
 * ```tsx
 * const { messages, send, stop, status, taskId } = useAgentChat(agentId);
 * ```
 */
export function useAgentChat(
  agentId: string,
  taskId?: string,
  options: UseAgentChatOptions = {},
): UseAgentChatResult {
  const client = useLunnoaClient();
  const { getAccessToken } = useAccessToken();
  const [resolvedTaskId] = useState(() => taskId ?? createTaskId());
  const chatMode = options.chatMode;

  const getAccessTokenRef = useRef(getAccessToken);
  getAccessTokenRef.current = getAccessToken;
  const clientRef = useRef(client);
  clientRef.current = client;
  const agentIdRef = useRef(agentId);
  agentIdRef.current = agentId;

  const api = useMemo(
    () =>
      `${client.http.baseUrl}/api/agents/${encodeURIComponent(agentId)}/tasks/${encodeURIComponent(resolvedTaskId)}/stream-message`,
    [client.http.baseUrl, agentId, resolvedTaskId],
  );

  const transport = useMemo(() => {
    const sharedFetch: typeof globalThis.fetch = (input, init) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input
            : String((input as Request).url);
      return client.http.fetch(url, init);
    };
    return new DefaultChatTransport({
      api,
      fetch: sharedFetch,
      headers: async (): Promise<Record<string, string>> => {
        const token = await getAccessTokenRef.current();
        if (!token) return {};
        return { Authorization: `Bearer ${token}` };
      },
      body: chatMode ? { chatMode } : undefined,
      prepareReconnectToStreamRequest: ({ headers, credentials }) => ({
        api,
        headers,
        credentials,
      }),
    });
  }, [api, chatMode, client.http]);


  const chat = useChat({
    id: resolvedTaskId,
    transport,
  });

  const send = useCallback(
    async (text: string) => {
      await chat.sendMessage({ text });
    },
    [chat],
  );

  const stop = useCallback(async () => {
    const assistantMessage = [...chat.messages]
      .reverse()
      .find((message) => message.role === 'assistant');
    chat.stop();
    try {
      await clientRef.current.agentChat.stop(
        agentIdRef.current,
        resolvedTaskId,
        { assistantMessage },
      );
    } catch {
      // Best-effort server cancel; local abort already happened.
    }
  }, [chat, resolvedTaskId]);

  return {
    taskId: resolvedTaskId,
    messages: chat.messages,
    status: chat.status,
    error: chat.error,
    send,
    stop,
  };
}
