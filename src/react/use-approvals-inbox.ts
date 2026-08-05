import { useCallback, useEffect, useRef, useState } from 'react';

import type { ApprovalInboxItem } from '../resources/approvals';
import { useLunnoaClient } from './auth';

export type ApprovalsInboxStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface UseApprovalsInboxOptions {
  /** Inbox filter; defaults to `pending`. */
  status?: 'pending' | 'done' | string;
  /**
   * Poll interval in ms. Off by default (`0` / `undefined`).
   * A common value for live inboxes is `15_000`.
   */
  pollIntervalMs?: number;
}

export interface UseApprovalsInboxResult {
  items: ApprovalInboxItem[];
  status: ApprovalsInboxStatus;
  error: Error | null;
  refresh: () => Promise<ApprovalInboxItem[]>;
  decide: (
    approvalId: string,
    body: { decision: 'approved' | 'rejected'; comment?: string },
  ) => Promise<void>;
}

function toError(error: unknown): Error {
  if (error instanceof Error) return error;
  return new Error(String(error));
}

/**
 * Approvals inbox for the current user (workspace API).
 *
 * ```tsx
 * const { items, decide, refresh } = useApprovalsInbox({ pollIntervalMs: 15_000 });
 * ```
 */
export function useApprovalsInbox(
  options: UseApprovalsInboxOptions = {},
): UseApprovalsInboxResult {
  const client = useLunnoaClient();
  const inboxStatus = options.status ?? 'pending';
  const pollIntervalMs = options.pollIntervalMs ?? 0;

  const [items, setItems] = useState<ApprovalInboxItem[]>([]);
  const [status, setStatus] = useState<ApprovalsInboxStatus>('idle');
  const [error, setError] = useState<Error | null>(null);
  const clientRef = useRef(client);
  clientRef.current = client;

  const refresh = useCallback(async (): Promise<ApprovalInboxItem[]> => {
    setStatus((prev) => (prev === 'ready' ? prev : 'loading'));
    try {
      const result = await clientRef.current.approvals.inbox({
        status: inboxStatus,
      });
      const next = result.items ?? [];
      setItems(next);
      setError(null);
      setStatus('ready');
      return next;
    } catch (err) {
      const next = toError(err);
      setError(next);
      setStatus('error');
      throw next;
    }
  }, [inboxStatus]);

  const decide = useCallback(
    async (
      approvalId: string,
      body: { decision: 'approved' | 'rejected'; comment?: string },
    ) => {
      await clientRef.current.approvals.decide(approvalId, body);
      await refresh();
    },
    [refresh],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await refresh();
      } catch {
        // Error state already set in refresh.
      }
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  useEffect(() => {
    if (!pollIntervalMs || pollIntervalMs <= 0) return;
    const id = setInterval(() => {
      void refresh().catch(() => {
        // Keep last good items; status/error updated in refresh.
      });
    }, pollIntervalMs);
    return () => clearInterval(id);
  }, [pollIntervalMs, refresh]);

  return { items, status, error, refresh, decide };
}
