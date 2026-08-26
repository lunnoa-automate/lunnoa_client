import { describe, expect, it } from 'vitest';

import {
  actionDetail,
  extractInputFields,
  filterActions,
  flattenActions,
  formatDefineActionSnippet,
  parseActionRef,
  resolveAction,
  type CatalogApp,
} from '../src/cli/catalog';
import { formatTable } from '../src/cli/print';

const APPS: CatalogApp[] = [
  {
    id: 'http',
    name: 'HTTP',
    availableForAgent: true,
    needsConnection: false,
    actions: [
      {
        id: 'http_action_send-request',
        name: 'Send request',
        description: 'HTTP call',
        availableForAgent: true,
        needsConnection: false,
        inputConfig: {
          method: { label: 'Method', type: 'select', required: true },
          url: { label: 'URL', type: 'text', required: true },
        },
      },
    ],
  },
  {
    id: 'gmail',
    name: 'Gmail',
    availableForAgent: true,
    needsConnection: true,
    actions: [
      {
        id: 'gmail_action_send-email',
        name: 'Send email',
        availableForAgent: true,
        needsConnection: true,
      },
      {
        id: 'gmail_action_draft',
        name: 'Create draft',
        availableForAgent: false,
        needsConnection: true,
      },
    ],
  },
];

describe('flatten and filter catalogue actions', () => {
  it('flattens app/action pairs', () => {
    const actions = flattenActions(APPS);
    expect(actions.map((a) => a.actionId)).toEqual([
      'http_action_send-request',
      'gmail_action_send-email',
      'gmail_action_draft',
    ]);
  });

  it('filters by app, agent availability, and query', () => {
    const actions = flattenActions(APPS);
    expect(filterActions(actions, { appId: 'gmail' })).toHaveLength(2);
    expect(filterActions(actions, { forAgent: true }).map((a) => a.actionId)).toEqual(
      ['http_action_send-request', 'gmail_action_send-email'],
    );
    expect(filterActions(actions, { query: 'email' }).map((a) => a.actionId)).toEqual(
      ['gmail_action_send-email'],
    );
  });
});

describe('resolveAction', () => {
  const actions = flattenActions(APPS);

  it('parses app.action refs', () => {
    expect(parseActionRef('http_action_send-request')).toEqual({
      actionId: 'http_action_send-request',
    });
    expect(parseActionRef('http.http_action_send-request')).toEqual({
      appId: 'http',
      actionId: 'http_action_send-request',
    });
  });

  it('resolves a unique action id', () => {
    expect(resolveAction(actions, 'http_action_send-request').appId).toBe('http');
  });

  it('throws a search hint when missing', () => {
    expect(() => resolveAction(actions, 'nope')).toThrow(/tools search nope/);
  });

  it('requires --app when the same action id exists on two apps', () => {
    const dupes = [
      ...actions,
      { ...actions[0]!, appId: 'http2', appName: 'HTTP 2' },
    ];
    expect(() => resolveAction(dupes, 'http_action_send-request')).toThrow(
      /multiple apps/,
    );
    expect(resolveAction(dupes, 'http_action_send-request', 'http2').appId).toBe(
      'http2',
    );
  });
});

describe('inputConfig and defineAction sketch', () => {
  it('reads map-shaped inputConfig', () => {
    const fields = extractInputFields({
      method: { label: 'Method', type: 'select', required: true },
      url: { label: 'URL', type: 'text', required: true },
    });
    expect(fields.map((f) => f.id)).toEqual(['method', 'url']);
    expect(fields[0]?.required).toBe(true);
  });

  it('reads section/field-shaped inputConfig', () => {
    const fields = extractInputFields({
      sections: [
        {
          fields: [
            { id: 'to', label: 'To', inputType: 'text', required: true },
          ],
        },
      ],
    });
    expect(fields).toEqual([
      { id: 'to', label: 'To', type: 'text', required: true },
    ]);
  });

  it('emits a defineAction snippet from tools get', () => {
    const action = flattenActions(APPS)[0]!;
    const snippet = formatDefineActionSnippet(action);
    expect(snippet).toContain("id: 'http_action_send-request'");
    expect(snippet).toContain("appId: 'http'");
    expect(snippet).toContain('// method — Method, select, required');
    expect(actionDetail(action).inputFields).toHaveLength(2);
  });
});

describe('formatTable', () => {
  it('renders a compact table or an empty hint', () => {
    expect(
      formatTable(
        [{ appId: 'http', actionId: 'http_action_send-request' }],
        [
          { key: 'appId', header: 'APP' },
          { key: 'actionId', header: 'ACTION' },
        ],
      ),
    ).toContain('http_action_send-request');
    expect(formatTable([], [{ key: 'id', header: 'ID' }])).toBe('No results.');
  });
});
