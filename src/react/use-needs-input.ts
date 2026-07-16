import { useCallback, useMemo } from 'react';

import type { ExecutionProgress, ExecutionProgressStep } from '../resources/executions';
import type { Execution, ExecutionPathStep, PendingInput } from '../types';
import { useLunnoaClient } from './auth';

export type NeedsInputSource =
  | ExecutionProgress
  | Pick<Execution, 'id' | 'executionPath' | 'pendingInput' | 'status'>
  | null
  | undefined;

export interface UseNeedsInputOptions {
  /** Called after a successful `submitInput`. */
  onSubmitted?: () => void | Promise<void>;
}

export interface UseNeedsInputResult {
  /** True when a step is currently waiting for input. */
  waiting: boolean;
  /** The `NEEDS_INPUT` step, when present. */
  waitingStep: ExecutionPathStep | ExecutionProgressStep | null;
  /**
   * Field schema for the waiting step (from `pendingInput` expansion), when
   * available.
   */
  pendingInput: PendingInput | null;
  executionId: string | null;
  nodeId: string | null;
  /**
   * Submits values keyed by field id, then optionally runs `onSubmitted`.
   * Throws when nothing is waiting.
   */
  submitInput: (values: Record<string, unknown>) => Promise<void>;
}

function resolveExecutionId(source: NeedsInputSource): string | null {
  if (!source) return null;
  if ('executionId' in source && typeof source.executionId === 'string') {
    return source.executionId;
  }
  if ('id' in source && typeof source.id === 'string') {
    return source.id;
  }
  return null;
}

function resolveSteps(
  source: NonNullable<NeedsInputSource>,
): Array<ExecutionPathStep | ExecutionProgressStep> {
  if ('steps' in source && Array.isArray(source.steps)) {
    return source.steps;
  }
  if ('executionPath' in source && Array.isArray(source.executionPath)) {
    return source.executionPath;
  }
  return [];
}

function resolvePendingInput(
  source: NonNullable<NeedsInputSource>,
  nodeId: string | null,
): PendingInput | null {
  const raw = 'pendingInput' in source ? source.pendingInput : undefined;
  if (!raw) return null;
  if (!Array.isArray(raw)) {
    // Defensive: treat a single object as one schema entry.
    if (typeof raw === 'object' && raw !== null && 'nodeId' in raw) {
      return raw as PendingInput;
    }
    return null;
  }
  if (raw.length === 0) return null;
  if (nodeId) {
    const match = raw.find((entry) => entry?.nodeId === nodeId);
    if (match) return match;
  }
  return raw[0] ?? null;
}

/**
 * Derives the waiting `NEEDS_INPUT` step from an execution or progress
 * snapshot and exposes `submitInput` for custom forms.
 *
 * ```tsx
 * const { waiting, pendingInput, submitInput } = useNeedsInput(progress);
 * ```
 */
export function useNeedsInput(
  source: NeedsInputSource,
  options: UseNeedsInputOptions = {},
): UseNeedsInputResult {
  const client = useLunnoaClient();
  const { onSubmitted } = options;

  const executionId = useMemo(() => resolveExecutionId(source), [source]);

  const waitingStep = useMemo(() => {
    if (!source) return null;
    return (
      resolveSteps(source).find((step) => step.status === 'NEEDS_INPUT') ?? null
    );
  }, [source]);

  const nodeId = waitingStep?.nodeId ?? null;

  const pendingInput = useMemo(() => {
    if (!source) return null;
    return resolvePendingInput(source, nodeId);
  }, [source, nodeId]);

  const submitInput = useCallback(
    async (values: Record<string, unknown>) => {
      if (!executionId || !nodeId) {
        throw new Error('No execution is waiting for input.');
      }
      await client.executions.submitInput(executionId, nodeId, values);
      await onSubmitted?.();
    },
    [client, executionId, nodeId, onSubmitted],
  );

  return {
    waiting: Boolean(waitingStep),
    waitingStep,
    pendingInput,
    executionId,
    nodeId,
    submitInput,
  };
}
