import { describe, expect, it } from 'vitest';

import {
  defineAction,
  defineAgent,
  defineAiConnection,
  defineConnection,
  defineEntityType,
  defineTrigger,
  defineWorkflow,
  ref,
  resolveActionAppId,
  resolveActionId,
  resolveTriggerAppId,
  type WorkflowStepDefinition,
} from '../src/define';
import { workflowDefinitionToUpsert } from '../src/resources/workflows';

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

  it('defineTrigger requires an id and infers the app', () => {
    const trigger = defineTrigger({
      id: 'flow-control_trigger_listen-for-webhook',
      input: { method: 'POST' },
    });
    expect(trigger.kind).toBe('trigger');
    expect(resolveTriggerAppId(trigger)).toBe('flow-control');
    expect(() => defineTrigger({ id: '' })).toThrow(/requires id/);
    expect(() =>
      defineTrigger({
        id: 'flow-control_trigger_manual',
        inputs: [{ id: '' }],
      }),
    ).toThrow(/inputs require id/);
    expect(() =>
      defineTrigger({
        id: 'flow-control_trigger_listen-for-webhook',
        inputs: [{ id: 'invoiceId' }],
      }),
    ).toThrow(/only valid on flow-control_trigger_manual/);
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

  it('ref builds step references and defineWorkflow checks them', () => {
    expect(ref.trigger('caseId')).toBe('={{step:trigger,caseId}}');
    expect(ref.step('load', 'rows', 0, 'status')).toBe('={{step:load,rows,0,status}}');
    expect(() => ref.step('load', 'a,b')).toThrow(/contain no/);

    const rpc = defineAction({ id: 'supabase_action_execute-rpc' });
    const llm = defineAction({ id: 'ai_action_message-llm' });
    const trigger = defineTrigger({
      id: 'flow-control_trigger_manual',
      inputs: [{ id: 'caseId' }],
    });
    const wf = defineWorkflow({
      slug: 'summarise-case',
      trigger,
      steps: [
        { key: 'load', use: rpc, input: { args: { case_id: ref.trigger('caseId') } } },
        { use: llm, input: { prompt: `Summarise ${ref.step('load', 'rows', 0)}` } },
      ],
    });
    expect(workflowDefinitionToUpsert(wf).steps[0]).toMatchObject({
      key: 'load',
      input: { args: { case_id: '={{step:trigger,caseId}}' } },
    });

    const build = (steps: WorkflowStepDefinition[]) =>
      defineWorkflow({ slug: 'x', trigger, steps });
    expect(() => build([{ use: rpc, input: { a: ref.trigger('missing') } }])).toThrow(
      /not declared in trigger inputs/,
    );
    expect(() =>
      build([{ use: rpc, input: { a: ref.step('later') } }, { key: 'later', use: rpc }]),
    ).toThrow(/later step/);
    expect(() => build([{ use: rpc, input: { a: ref.step('nope') } }])).toThrow(/unknown key/);
    expect(() => build([{ key: 'a', use: rpc }, { key: 'a', use: rpc }])).toThrow(/used twice/);
    expect(() => build([{ key: 'trigger', use: rpc }])).toThrow(/must start with a letter/);
    expect(() =>
      defineWorkflow({
        slug: 'hook',
        trigger: defineTrigger({ id: 'flow-control_trigger_listen-for-webhook' }),
        steps: [{ use: rpc, input: { a: ref.trigger('body', 'id') } }],
      }),
    ).not.toThrow();
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

  it('defineEntityType defaults to strict unknown attributes', () => {
    const type = defineEntityType({
      slug: 'human',
      name: 'Human',
      attributeSchema: { version: '1.0', sections: [] },
    });
    expect(type.kind).toBe('entityType');
    expect(type.allowUnknownAttributes).toBe(false);
  });

  it('defineEntityType requires slug and attributeSchema', () => {
    expect(() =>
      defineEntityType({
        slug: '',
        attributeSchema: { version: '1.0', sections: [] },
      }),
    ).toThrow(/slug/);
    expect(() =>
      defineEntityType({
        slug: 'x',
        attributeSchema: null as unknown as Record<string, unknown>,
      }),
    ).toThrow(/attributeSchema/);
  });
});
