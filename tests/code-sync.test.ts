import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { reportCliError, run } from '../src/cli/index';
import { findSecretFields } from '../src/cli/sync/diff';
import { pullResources, pushResources, statusResources } from '../src/cli/sync/engine';
import {
  assertInsideDefinitionsDir,
  hashDefinition,
  writeGuarded,
} from '../src/cli/sync/store';
import { LunnoaApiError } from '../src/core/errors';
import { HttpClient } from '../src/core/http';
import {
  defineAction,
  defineAgent,
  defineWorkflow,
} from '../src/define';
import { LunnoaClient } from '../src/client';
import { agentDefinitionToUpsert } from '../src/resources/agents';
import { workflowDefinitionToUpsert } from '../src/resources/workflows';
import { FAKE_API_KEY } from './fixtures';

const dirs: string[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  process.exitCode = undefined;
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'lunnoa-sync-'));
  dirs.push(dir);
  return dir;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const agentDefinition = {
  kind: 'agent' as const,
  slug: 'triage',
  name: 'Local Name',
  model: 'gpt-4o',
  instructions: 'Be helpful.',
  settings: { temperature: 0.2 },
  tools: [
    {
      key: 'send',
      id: 'http_action_send-request',
      name: 'Send',
      input: { url: 'https://example.test', apiKey: 'super-secret-value' },
    },
  ],
  workflows: [{ slug: 'sync-orders' }],
  agents: [],
  connections: [],
  knowledge: [],
  variables: [],
  objects: [],
  objectTypes: [],
  mcpServers: [],
  a2aAgents: [],
};

function clientWith(fetchMock: typeof fetch): LunnoaClient {
  return new LunnoaClient({
    baseUrl: 'https://lunnoa.example',
    apiKey: FAKE_API_KEY,
    fetch: fetchMock,
  });
}

describe('definition files', () => {
  it('defineAgent and defineWorkflow accept file JSON', () => {
    const agent = defineAgent({
      $schema: '../agent.schema.json',
      slug: 'triage',
      name: 'Triage',
      instructions: { file: 'triage.instructions.md' },
      settings: { temperature: 0.2 },
      tools: [
        {
          key: 'send',
          id: 'http_action_send-request',
          name: 'Send',
          input: { url: 'https://example.test' },
        },
      ],
      workflows: [{ slug: 'sync-orders' }],
    });
    expect(agent.kind).toBe('agent');
    expect(agent.instructions).toEqual({ file: 'triage.instructions.md' });
    expect(agent).not.toHaveProperty('$schema');

    const steps = defineWorkflow({
      $schema: '../workflow.schema.json',
      format: 'steps',
      slug: 'sync-orders',
      name: 'Sync',
      trigger: { id: 'flow-control_trigger_manual', name: 'Manual' },
      steps: [
        {
          key: 'send',
          name: 'Send',
          description: 'Sends the request',
          use: { id: 'http_action_send-request' },
          input: { url: 'https://example.test' },
          retrySettings: { enabled: true, maxAttempts: 3, delaySeconds: 5 },
          continueOnFailure: { enabled: false },
        },
      ],
    });
    expect(steps.format).toBe('steps');
    expect(steps).not.toHaveProperty('$schema');
    expect(steps.steps[0]?.retrySettings?.maxAttempts).toBe(3);

    const graph = defineWorkflow({
      format: 'graph',
      slug: 'branched',
      name: 'Branched',
      nodes: [
        {
          key: 'trigger',
          nodeType: 'trigger',
          appId: 'flow-control',
          triggerId: 'flow-control_trigger_manual',
          name: 'Start',
          value: {},
        },
        {
          key: 'send',
          nodeType: 'action',
          appId: 'http',
          actionId: 'http_action_send-request',
          name: 'Send',
          value: { url: 'https://example.test' },
        },
      ],
      edges: [{ source: 'trigger', target: 'send' }],
    });
    expect(graph.format).toBe('graph');
    expect(graph.nodes).toHaveLength(2);

    const authored = defineWorkflow({
      slug: 'ping',
      steps: [{ use: defineAction({ id: 'http_action_send-request' }) }],
    });
    expect(authored.kind).toBe('workflow');
    expect(authored).not.toHaveProperty('format');

    expect(() =>
      defineWorkflow({
        format: 'graph',
        slug: 'bad',
        name: 'Bad',
        nodes: [
          { key: 'trigger', nodeType: 'trigger', appId: 'flow-control', name: 'A', value: {} },
          { key: 'trigger', nodeType: 'action', appId: 'http', name: 'B', value: {} },
        ],
        edges: [],
      }),
    ).toThrow(/used twice/);
    expect(() =>
      defineWorkflow({
        format: 'graph',
        slug: 'bad',
        name: 'Bad',
        nodes: [
          { key: 'start', nodeType: 'trigger', appId: 'flow-control', name: 'A', value: {} },
          { key: 'other', nodeType: 'trigger', appId: 'flow-control', name: 'B', value: {} },
        ],
        edges: [],
      }),
    ).toThrow(/exactly one trigger/);
    expect(() =>
      defineWorkflow({
        format: 'graph',
        slug: 'bad',
        name: 'Bad',
        nodes: [
          { key: 'trigger', nodeType: 'trigger', appId: 'flow-control', name: 'A', value: {} },
        ],
        edges: [{ source: 'trigger', target: 'missing' }],
      }),
    ).toThrow(/unknown key/);
  });

  it('maps file definitions and keeps the TypeScript payload except codeSource', () => {
    const tsWorkflow = workflowDefinitionToUpsert(
      defineWorkflow({
        slug: 'ping',
        steps: [{ use: defineAction({ id: 'http_action_send-request' }) }],
      }),
    );
    expect(tsWorkflow).toEqual({
      slug: 'ping',
      name: undefined,
      description: undefined,
      isActive: undefined,
      codeSource: 'generated',
      steps: [
        {
          appId: 'http',
          actionId: 'http_action_send-request',
          connectionId: undefined,
          input: {},
          name: undefined,
          description: undefined,
        },
      ],
    });
    expect(tsWorkflow).not.toHaveProperty('managedByCode');

    const tsAgent = agentDefinitionToUpsert(
      defineAgent({
        slug: 'triage',
        model: 'gpt-4o',
        instructions: 'Help.',
        tools: [defineAction({ id: 'http_action_send-request' })],
      }),
    );
    expect(tsAgent).toEqual({
      slug: 'triage',
      name: undefined,
      description: undefined,
      instructions: 'Help.',
      model: 'gpt-4o',
      aiConnectionId: undefined,
      connectionIds: undefined,
      workflowIds: undefined,
      tools: [
        {
          appId: 'http',
          actionId: 'http_action_send-request',
          connectionId: undefined,
          name: undefined,
          description: undefined,
          input: undefined,
        },
      ],
      codeSource: 'generated',
    });
    expect(tsAgent).not.toHaveProperty('managedByCode');

    const fileWorkflow = workflowDefinitionToUpsert(
      defineWorkflow({
        format: 'steps',
        slug: 'sync-orders',
        name: 'Sync',
        description: 'Pulls orders',
        trigger: {
          id: 'flow-control_trigger_manual',
          name: 'Manual',
          input: { source: 'inbox' },
        },
        steps: [
          {
            key: 'send',
            name: 'Send',
            description: 'Sends the request',
            use: { id: 'http_action_send-request' },
            input: { url: 'https://example.test' },
            retrySettings: { enabled: true, maxAttempts: 3, delaySeconds: 5 },
            continueOnFailure: { enabled: false },
          },
        ],
      }),
    );
    expect(fileWorkflow).toMatchObject({
      slug: 'sync-orders',
      name: 'Sync',
      codeSource: 'synced',
      trigger: {
        triggerId: 'flow-control_trigger_manual',
        appId: 'flow-control',
        name: 'Manual',
        input: { source: 'inbox' },
      },
      steps: [
        {
          key: 'send',
          name: 'Send',
          description: 'Sends the request',
          actionId: 'http_action_send-request',
          appId: 'http',
          retrySettings: { enabled: true, maxAttempts: 3, delaySeconds: 5 },
          continueOnFailure: { enabled: false },
        },
      ],
    });
    expect(fileWorkflow).not.toHaveProperty('managedByCode');
    expect(fileWorkflow).not.toHaveProperty('graph');

    const graph = workflowDefinitionToUpsert(
      defineWorkflow({
        format: 'graph',
        slug: 'branched',
        name: 'Branched',
        nodes: [
          {
            key: 'trigger',
            nodeType: 'trigger',
            appId: 'flow-control',
            triggerId: 'flow-control_trigger_manual',
            name: 'Start',
            value: {},
          },
          {
            key: 'send',
            nodeType: 'action',
            appId: 'http',
            actionId: 'http_action_send-request',
            name: 'Send',
            value: { url: 'https://example.test' },
          },
        ],
        edges: [{ source: 'trigger', target: 'send' }],
      }),
    );
    expect(graph.codeSource).toBe('synced');
    expect(graph.graph?.nodes).toHaveLength(2);
    expect(graph.graph?.edges[0]).toEqual({ source: 'trigger', target: 'send' });
    expect(graph.steps).toBeUndefined();

    const fileAgent = agentDefinitionToUpsert(
      defineAgent({
        slug: 'triage',
        name: 'Triage',
        model: 'gpt-4o',
        instructions: 'Help.',
        aiConnection: { id: 'ai-1' },
        settings: { temperature: 0.2 },
        tools: [
          {
            key: 'send',
            id: 'http_action_send-request',
            name: 'Send',
            input: { url: 'https://example.test' },
          },
        ],
        workflows: [{ slug: 'sync-orders' }],
        agents: [{ id: 'agent-2' }],
        connections: [{ id: 'c1' }],
        knowledge: [{ id: 'k1' }],
        variables: [{ id: 'v1' }],
        objects: [{ id: 'o1' }],
        objectTypes: [{ id: 'ot1' }],
        mcpServers: [{ id: 'm1', connectionId: 'c2' }],
        a2aAgents: [{ id: 'a1' }],
      }),
    );
    expect(fileAgent).toMatchObject({
      slug: 'triage',
      name: 'Triage',
      instructions: 'Help.',
      model: 'gpt-4o',
      aiConnectionId: 'ai-1',
      codeSource: 'synced',
      settings: { temperature: 0.2 },
      tools: [
        {
          key: 'send',
          appId: 'http',
          actionId: 'http_action_send-request',
          name: 'Send',
          input: { url: 'https://example.test' },
        },
      ],
      workflows: [{ slug: 'sync-orders' }],
      agents: [{ id: 'agent-2' }],
      connectionIds: ['c1'],
      knowledgeIds: ['k1'],
      variableIds: ['v1'],
      objectIds: ['o1'],
      objectTypeIds: ['ot1'],
      mcpServers: [{ id: 'm1', connectionId: 'c2' }],
      a2aAgentIds: ['a1'],
    });
    expect(fileAgent).not.toHaveProperty('managedByCode');
    expect(fileAgent).not.toHaveProperty('workflowIds');
  });
});

describe('sync', () => {
  it('pull of a new agent writes JSON, instructions, and the lock', async () => {
    const dir = await tempDir();
    const methods: string[] = [];
    const warnings: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((message?: unknown) => {
      warnings.push(String(message));
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      methods.push(init?.method ?? 'GET');
      const url = String(input);
      if (url.endsWith('/api/code-sync/context')) {
        return json({ workspaceId: 'ws-1', lockCodeSyncedResources: false });
      }
      if (url.endsWith('/api/agents/slug/triage/definition')) {
        return json({
          id: 'ag-1',
          slug: 'triage',
          workspaceId: 'ws-1',
          codeSource: 'none',
          revision: 'rev-1',
          definition: agentDefinition,
        });
      }
      return json({ message: 'no' }, 404);
    });
    const report = await pullResources(
      {
        client: clientWith(fetchMock),
        definitionsDir: dir,
        projectRoot: dir,
      },
      { scope: 'one', kind: 'agent', slug: 'triage' },
    );
    expect(methods.every((method) => method === 'GET')).toBe(true);
    expect(report.written).toEqual(['agents/triage.json']);

    const jsonText = await readFile(join(dir, 'agents', 'triage.json'), 'utf8');
    const instructions = await readFile(join(dir, 'agents', 'triage.instructions.md'), 'utf8');
    expect(jsonText.endsWith('\n')).toBe(true);
    expect(jsonText.indexOf('"$schema"')).toBeLessThan(jsonText.indexOf('"kind"'));
    const parsed = JSON.parse(jsonText) as { $schema: string; instructions: { file: string } };
    expect(parsed.$schema).toBe('../node_modules/@lunnoa/client/schemas/agent.schema.json');
    expect(parsed.instructions).toEqual({ file: 'triage.instructions.md' });
    expect(instructions).toBe('Be helpful.');

    const lock = JSON.parse(await readFile(join(dir, 'lunnoa.lock.json'), 'utf8')) as {
      version: number;
      deployments: Record<string, { agents: Record<string, { id: string; revision: string; fileHash: string }> }>;
    };
    expect(lock.version).toBe(1);
    const entry = lock.deployments['https://lunnoa.example#ws-1']?.agents.triage;
    expect(entry).toMatchObject({ id: 'ag-1', revision: 'rev-1' });
    expect(entry?.fileHash).toBe(hashDefinition(jsonText, instructions));
    expect(warnings.join('\n')).toContain('apiKey');
    expect(warnings.join('\n')).not.toContain('super-secret-value');
    expect(findSecretFields({
      tools: [{ input: { token: '={{step:trigger,token}}', apiKey: 'abc' } }],
    })).toEqual(['tools[0].input.apiKey']);
  });

  it('push sends baseRevision for tracked files, omits it when untracked, and pull writes nothing afterward', async () => {
    const dir = await tempDir();
    await mkdir(join(dir, 'workflows'), { recursive: true });
    const tracked = {
      kind: 'workflow',
      format: 'steps',
      slug: 'sync-orders',
      name: 'Local sync',
      trigger: { id: 'flow-control_trigger_manual', name: 'Manual' },
      steps: [
        {
          key: 'send',
          name: 'Send',
          use: { id: 'http_action_send-request' },
          input: { url: 'https://example.test' },
        },
      ],
    };
    const untracked = { ...tracked, slug: 'new-flow', name: 'New' };
    await writeFile(join(dir, 'workflows', 'sync-orders.json'), `${JSON.stringify(tracked, null, 2)}\n`);
    await writeFile(join(dir, 'workflows', 'new-flow.json'), `${JSON.stringify(untracked, null, 2)}\n`);
    await writeFile(
      join(dir, 'lunnoa.lock.json'),
      `${JSON.stringify(
        {
          version: 1,
          deployments: {
            'https://other.example#ws-9': { agents: {}, workflows: {} },
            'https://lunnoa.example#ws-1': {
              agents: {},
              workflows: {
                'sync-orders': { id: 'wf-1', revision: 'rev-old', fileHash: 'stale' },
              },
            },
          },
        },
        null,
        2,
      )}\n`,
    );

    const bodies: Array<Record<string, unknown>> = [];
    const server = new Map<string, { revision: string; definition: unknown }>();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/code-sync/context')) {
        return json({ workspaceId: 'ws-1', lockCodeSyncedResources: false });
      }
      if (url.endsWith('/api/workflows/upsert')) {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        bodies.push(body);
        const slug = String(body.slug);
        const definition = {
          kind: 'workflow',
          format: 'steps',
          slug,
          name: `${slug} from server`,
          trigger: { id: 'flow-control_trigger_manual', name: 'Manual' },
          steps: tracked.steps,
        };
        const row = { revision: `rev-${slug}`, definition };
        server.set(slug, row);
        return json({
          id: `id-${slug}`,
          slug,
          workspaceId: 'ws-1',
          codeSource: 'synced',
          revision: row.revision,
          definition,
        });
      }
      const match = /\/api\/workflows\/slug\/([^/]+)\/definition$/.exec(url);
      if (match && (init?.method ?? 'GET') === 'GET') {
        const row = server.get(decodeURIComponent(match[1]!));
        if (!row) return json({ message: 'no' }, 404);
        return json({
          id: `id-${match[1]}`,
          slug: match[1],
          workspaceId: 'ws-1',
          codeSource: 'synced',
          revision: row.revision,
          definition: row.definition,
        });
      }
      return json({ message: 'no' }, 404);
    });

    const lunnoa = clientWith(fetchMock);
    await pushResources(
      { client: lunnoa, definitionsDir: dir, projectRoot: dir },
      { scope: 'all' },
    );
    const trackedBody = bodies.find((body) => body.slug === 'sync-orders');
    const untrackedBody = bodies.find((body) => body.slug === 'new-flow');
    expect(trackedBody).toMatchObject({
      codeSource: 'synced',
      baseRevision: 'rev-old',
      slug: 'sync-orders',
    });
    expect(untrackedBody).toMatchObject({ codeSource: 'synced', slug: 'new-flow' });
    expect(untrackedBody).not.toHaveProperty('baseRevision');
    expect(bodies.map((body) => body.slug).sort()).toEqual(['new-flow', 'sync-orders']);

    const written = await readFile(join(dir, 'workflows', 'sync-orders.json'), 'utf8');
    expect(written).toContain('sync-orders from server');
    expect(written.indexOf('"$schema"')).toBeLessThan(written.indexOf('"kind"'));
    const lock = JSON.parse(await readFile(join(dir, 'lunnoa.lock.json'), 'utf8')) as {
      deployments: Record<string, { workflows: Record<string, { revision: string; fileHash: string }> }>;
    };
    expect(lock.deployments['https://other.example#ws-9']).toBeTruthy();
    expect(lock.deployments['https://lunnoa.example#ws-1']?.workflows['sync-orders']).toMatchObject({
      id: 'id-sync-orders',
      revision: 'rev-sync-orders',
      fileHash: hashDefinition(written),
    });

    const before = await readFile(join(dir, 'workflows', 'sync-orders.json'));
    const pull = await pullResources(
      { client: lunnoa, definitionsDir: dir, projectRoot: dir },
      { scope: 'one', kind: 'workflow', slug: 'sync-orders' },
    );
    expect(pull.written).toEqual([]);
    expect(pull.skipped).toEqual(['workflows/sync-orders.json']);
    expect(await readFile(join(dir, 'workflows', 'sync-orders.json'))).toEqual(before);
    expect(fetchMock.mock.calls.slice(-2).every((call) => (call[1]?.method ?? 'GET') === 'GET')).toBe(true);
  });

  it('a 409 makes push exit with the server message', async () => {
    const dir = await tempDir();
    await mkdir(join(dir, 'agents'), { recursive: true });
    await writeFile(
      join(dir, 'agents', 'triage.json'),
      `${JSON.stringify(
        {
          ...agentDefinition,
          instructions: { file: 'triage.instructions.md' },
          tools: [{ key: 'send', id: 'http_action_send-request', name: 'Send', input: {} }],
        },
        null,
        2,
      )}\n`,
    );
    await writeFile(join(dir, 'agents', 'triage.instructions.md'), 'Be helpful.');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/api/code-sync/context')) {
          return json({ workspaceId: 'ws-1', lockCodeSyncedResources: false });
        }
        return json(
          {
            message: 'Changed in the UI since your last pull. Run pull first.',
            currentRevision: 'rev-server',
          },
          409,
        );
      }),
    );
    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((message?: unknown) => {
      errors.push(String(message));
    });
    process.exitCode = 0;
    try {
      await run([
        'push',
        'agents/triage',
        '--dir',
        dir,
        '--url',
        'https://lunnoa.example',
        '--api-key',
        FAKE_API_KEY,
      ]);
      expect.fail('push should throw');
    } catch (error) {
      reportCliError(error);
    }
    const output = errors.join('\n');
    expect(process.exitCode).toBe(1);
    expect(output).toContain('Changed in the UI since your last pull. Run pull first.');
    expect(output).toContain('currentRevision: rev-server');
    expect(output).not.toContain(FAKE_API_KEY);
  });

  it('pull stops with a diff when both sides changed, and --force overwrites', async () => {
    const dir = await tempDir();
    let revision = 'rev-1';
    let name = 'Local Name';
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/code-sync/context')) {
        return json({ workspaceId: 'ws-1', lockCodeSyncedResources: false });
      }
      return json({
        id: 'ag-1',
        slug: 'triage',
        workspaceId: 'ws-1',
        codeSource: 'synced',
        revision,
        definition: { ...agentDefinition, name },
      });
    });
    const request = {
      client: clientWith(fetchMock),
      definitionsDir: dir,
      projectRoot: dir,
    };
    await pullResources(request, { scope: 'one', kind: 'agent', slug: 'triage' });
    const jsonPath = join(dir, 'agents', 'triage.json');
    const parsed = JSON.parse(await readFile(jsonPath, 'utf8')) as { name: string };
    parsed.name = 'Edited Local';
    await writeFile(jsonPath, `${JSON.stringify(parsed, null, 2)}\n`);
    await writeFile(join(dir, 'agents', 'triage.instructions.md'), 'Edited instructions');
    revision = 'rev-2';
    name = 'Server Name';

    await expect(
      pullResources(request, { scope: 'one', kind: 'agent', slug: 'triage' }),
    ).rejects.toThrow(/Edited Local[\s\S]*Server Name|Server Name[\s\S]*Edited Local/);
    try {
      await pullResources(request, { scope: 'one', kind: 'agent', slug: 'triage' });
    } catch (error) {
      expect((error as Error).message).not.toContain('super-secret-value');
      expect((error as Error).message).toContain('"***"');
    }
    expect(JSON.parse(await readFile(jsonPath, 'utf8')).name).toBe('Edited Local');

    await pullResources(
      { ...request, force: true },
      { scope: 'one', kind: 'agent', slug: 'triage' },
    );
    const forced = JSON.parse(await readFile(jsonPath, 'utf8')) as { name: string };
    expect(forced.name).toBe('Server Name');
    expect(await readFile(join(dir, 'agents', 'triage.instructions.md'), 'utf8')).toBe('Be helpful.');
    expect(JSON.parse(await readFile(join(dir, 'lunnoa.lock.json'), 'utf8')).deployments[
      'https://lunnoa.example#ws-1'
    ].agents.triage.revision).toBe('rev-2');
  });

  it('status reports local modified, changed in UI, and conflict', async () => {
    const dir = await tempDir();
    const revisions: Record<string, string> = { edited: 'rev-1', remote: 'rev-1', both: 'rev-1' };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/code-sync/context')) {
        return json({ workspaceId: 'ws-1', lockCodeSyncedResources: false });
      }
      const match = /\/api\/agents\/slug\/([^/]+)\/definition$/.exec(url);
      const slug = decodeURIComponent(match?.[1] ?? '');
      return json({
        id: `id-${slug}`,
        slug,
        workspaceId: 'ws-1',
        codeSource: 'synced',
        revision: revisions[slug],
        definition: {
          ...agentDefinition,
          slug,
          name: slug,
          tools: [{ key: 'send', id: 'http_action_send-request', name: 'Send', input: {} }],
        },
      });
    });
    const request = {
      client: clientWith(fetchMock),
      definitionsDir: dir,
      projectRoot: dir,
    };
    for (const slug of ['edited', 'remote', 'both']) {
      await pullResources(request, { scope: 'one', kind: 'agent', slug });
    }
    const editedPath = join(dir, 'agents', 'edited.json');
    const edited = JSON.parse(await readFile(editedPath, 'utf8')) as { name: string };
    edited.name = 'Touched';
    await writeFile(editedPath, `${JSON.stringify(edited, null, 2)}\n`);
    const bothPath = join(dir, 'agents', 'both.json');
    const both = JSON.parse(await readFile(bothPath, 'utf8')) as { name: string };
    both.name = 'Touched both';
    await writeFile(bothPath, `${JSON.stringify(both, null, 2)}\n`);
    revisions.remote = 'rev-2';
    revisions.both = 'rev-2';

    const rows = await statusResources(request);
    expect(rows).toEqual([
      expect.objectContaining({ slug: 'both', local: 'modified', remote: 'changed in UI', conflict: true }),
      expect.objectContaining({ slug: 'edited', local: 'modified', remote: 'unchanged', conflict: false }),
      expect.objectContaining({ slug: 'remote', local: 'unchanged', remote: 'changed in UI', conflict: false }),
    ]);
  });
});

describe('path guard', () => {
  it('rejects ../, absolute paths, and symlink escapes', async () => {
    const dir = await tempDir();
    await expect(assertInsideDefinitionsDir(dir, '../outside.json')).rejects.toThrow(/outside/);
    await expect(assertInsideDefinitionsDir(dir, '/etc/passwd')).rejects.toThrow(/outside/);
    await mkdir(join(dir, 'agents'));
    const outside = await tempDir();
    await symlink(outside, join(dir, 'agents', 'link'));
    await expect(writeGuarded(dir, join('agents', 'link', 'file.json'), 'x')).rejects.toThrow(
      /outside/,
    );
    await writeGuarded(dir, join('agents', 'ok.json'), '{}\n');
    expect(await readFile(join(dir, 'agents', 'ok.json'), 'utf8')).toBe('{}\n');
  });
});

describe('409 error', () => {
  it('includes the server message and currentRevision', async () => {
    const http = new HttpClient({
      baseUrl: 'https://lunnoa.example',
      apiKey: FAKE_API_KEY,
      fetch: vi.fn(async () =>
        json(
          {
            message: 'Changed in the UI since your last pull. Run pull first.',
            currentRevision: 'rev-server',
          },
          409,
        ),
      ),
    });
    await expect(http.get('/api/agents/upsert')).rejects.toMatchObject({
      status: 409,
      currentRevision: 'rev-server',
    });
    try {
      await http.get('/api/agents/upsert');
    } catch (error) {
      expect(error).toBeInstanceOf(LunnoaApiError);
      expect((error as Error).message).toContain(
        'Changed in the UI since your last pull. Run pull first.',
      );
      expect((error as Error).message).toContain('currentRevision: rev-server');
    }
  });
});
