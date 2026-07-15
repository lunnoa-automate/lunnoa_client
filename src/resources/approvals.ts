import type { HttpClient } from '../core/http';

export type EligibleApprover = {
  workspaceUserId: string;
  email: string;
  name?: string;
};

export type ApprovalInboxItem = {
  approvalId: string;
  executionId: string;
  nodeId: string;
  title: string;
  status: string;
  requiredCount: number;
  receivedApprovals: number;
  currentStageIndex?: number;
  expiresAt?: string;
  createdAt?: string;
  updatedAt?: string;
  canDecide?: boolean;
  executionNumber?: number;
  workflow?: { id: string; name: string };
  project?: { id: string; name: string };
  myDecision?: {
    decision: string;
    comment?: string;
    decidedAt?: string;
  };
  /** People who can still decide (current stage; emails resolved). */
  eligibleApprovers?: EligibleApprover[];
  approval?: Record<string, unknown>;
};

/**
 * Authenticated Approvals inbox helpers (workspace API; not Public API v1).
 */
export class ApprovalsResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * @param options.status `pending` (default) for actionable items, or `done` for history.
   */
  async inbox(options?: {
    status?: 'pending' | 'done' | string;
  }): Promise<{ items: ApprovalInboxItem[] }> {
    return this.http.get('/api/approvals/inbox', {
      query: { status: options?.status ?? 'pending' },
    });
  }

  async decide(
    approvalId: string,
    body: {
      decision: 'approved' | 'rejected';
      comment?: string;
    },
  ): Promise<{
    executionId: string;
    nodeId: string;
    approvalId?: string;
    terminal: boolean;
    canDecide: boolean;
    approval: Record<string, unknown>;
  }> {
    return this.http.post(`/api/approvals/${approvalId}/decide`, { body });
  }
}
