/**
 * Optional React helpers for apps whose users sign in to Lunnoa.
 * Import from `@lunnoa/client/react` (peer dependency: `react` ≥ 18).
 *
 * Agent chat uses `@ai-sdk/react` (a dependency of this package).
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
