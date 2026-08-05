/**
 * Optional React helpers for Pattern B portals.
 * Import from `@lunnoa/client/react` (peer dependency: `react` ≥ 18).
 *
 * Agent chat additionally needs optional peer `@ai-sdk/react`.
 */
export {
  LunnoaAuthProvider,
  useAccessToken,
  useLunnoaAuth,
  useLunnoaClient,
  type AuthStatus,
  type LunnoaAuthContextValue,
  type LunnoaAuthProviderProps,
} from './auth';

export {
  useExecutionProgress,
  type ExecutionProgressStatus,
  type UseExecutionProgressResult,
} from './use-execution-progress';

export {
  useNeedsInput,
  type NeedsInputSource,
  type UseNeedsInputOptions,
  type UseNeedsInputResult,
} from './use-needs-input';

export {
  useAgentChat,
  type UseAgentChatOptions,
  type UseAgentChatResult,
} from './use-agent-chat';

export {
  useApprovalsInbox,
  type ApprovalsInboxStatus,
  type UseApprovalsInboxOptions,
  type UseApprovalsInboxResult,
} from './use-approvals-inbox';

export {
  useEntityList,
  type EntityListStatus,
  type UseEntityListOptions,
  type UseEntityListResult,
} from './use-entity-list';
