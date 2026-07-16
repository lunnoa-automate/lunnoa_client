import { useCallback, useEffect, useRef, useState } from 'react';

import type { ExecutionProgress } from '../resources/executions';
import { useLunnoaClient } from './auth';

const TERMINAL_STATUSES = new Set(['SUCCESS', 'FAILED', 'CANCELLED']);

export type ExecutionProgressStatus =
  | 'idle'
  | 'loading'
  | 'live'
  | 'error'
  | 'finished';

export interface UseExecutionProgressResult {
  /** Latest progress snapshot, or null before the first update. */
  progress: ExecutionProgress | null;
  status: ExecutionProgressStatus;
  error: Error | null;
  /** Fetches a one-shot snapshot via `executions.getProgress`. */
  refresh: () => Promise<ExecutionProgress | null>;
}

function toError(error: unknown): Error {
  if (error instanceof Error) return error;
  return new Error(String(error));
}

function isTerminal(status: string | undefined | null): boolean {
  return Boolean(status && TERMINAL_STATUSES.has(status));
}

/**
 * Live execution timeline for a custom UI.
 *
 * When `executionId` is set, subscribes via `executions.watchProgress` and
 * keeps the latest snapshot. Aborts the stream on unmount or id change.
 *
 * ```tsx
 * const { progress, status, error, refresh } = useExecutionProgress(executionId);
 * ```
 */
export function useExecutionProgress(
  executionId: string | null,
): UseExecutionProgressResult {
  const client = useLunnoaClient();
  const [progress, setProgress] = useState<ExecutionProgress | null>(null);
  const [status, setStatus] = useState<ExecutionProgressStatus>('idle');
  const [error, setError] = useState<Error | null>(null);
  const clientRef = useRef(client);
  clientRef.current = client;

  const refresh = useCallback(async (): Promise<ExecutionProgress | null> => {
    if (!executionId) {
      setProgress(null);
      setStatus('idle');
      setError(null);
      return null;
    }
    try {
      const snapshot = await clientRef.current.executions.getProgress(
        executionId,
      );
      setProgress(snapshot);
      setError(null);
      setStatus(isTerminal(snapshot.status) ? 'finished' : 'live');
      return snapshot;
    } catch (err) {
      const next = toError(err);
      setError(next);
      setStatus('error');
      throw next;
    }
  }, [executionId]);

  useEffect(() => {
    if (!executionId) {
      setProgress(null);
      setStatus('idle');
      setError(null);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;

    setStatus('loading');
    setError(null);

    void (async () => {
      try {
        for await (const snapshot of clientRef.current.executions.watchProgress(
          executionId,
          { signal: controller.signal },
        )) {
          if (cancelled) return;
          setProgress(snapshot);
          setError(null);
          if (isTerminal(snapshot.status)) {
            setStatus('finished');
            return;
          }
          setStatus('live');
        }
        if (!cancelled) {
          setStatus((prev) => (prev === 'error' ? prev : 'finished'));
        }
      } catch (err) {
        if (cancelled || controller.signal.aborted) return;
        setError(toError(err));
        setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [executionId]);

  return { progress, status, error, refresh };
}
