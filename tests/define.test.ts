import { describe, expect, it } from 'vitest';

import {
  defineAction,
  defineAgent,
  defineAiConnection,
  defineConnection,
  defineWorkflow,
  resolveActionAppId,
  resolveActionId,
} from '../src/define';

describe('define* factories', () => {
  it('defineConnection / defineAiConnection return branded refs', () => {
    expect(defineConnection({ id: 'conn-1' })).toEqual({
      kind: 'connection',
      id: 'conn-1',
    });
    expect(defineAiConnection()).toEqual({ kind: 'aiConnection' });
  });

  it('defineAction requires id and preserves connection', () => {
    const conn = defineConnection({ id: 'c1' });
    const action = defineAction({
      id: 'http_action_send-request',
      connection: conn,
      input: { method: 'GET' },
    });
    expect(action.kind).toBe('action');
    expect(resolveActionAppId(action)).toBe('http');
    expect(resolveActionId(action)).toBe('http_action_send-request');
  });

  it('defineWorkflow builds a linear definition', () => {
    const wf = defineWorkflow({
      slug: 'ping-then-template',
      steps: [
        {
          use: defineAction({ id: 'http_action_send-request', appId: 'http' }),
        },
      ],
    });
    expect(wf.kind).toBe('workflow');
    expect(wf.steps).toHaveLength(1);
  });

  it('defineAgent requires slug, model, instructions', () => {
    const agent = defineAgent({
      slug: 'triage',
      model: 'gpt-4o',
      instructions: 'Be helpful.',
      aiConnection: defineAiConnection({ id: 'ai-1' }),
      tools: [defineAction({ id: 'http_action_send-request' })],
    });
    expect(agent.kind).toBe('agent');
    expect(agent.tools).toHaveLength(1);
  });

  it('throws when required fields are missing', () => {
    expect(() => defineAction({ id: '' })).toThrow(/requires id/);
    expect(() => defineWorkflow({ slug: 'x', steps: [] })).toThrow(/step/);
    expect(() =>
      defineAgent({ slug: 'a', model: '', instructions: 'x' }),
    ).toThrow(/model/);
  });
});
