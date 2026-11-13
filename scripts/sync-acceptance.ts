/**
 * Two-way sync acceptance (SDK files ↔ Lunnoa UI).
 *
 * Drives the built CLI against a real server. Unique slugs per run.
 *
 *   LUNNOA_URL=http://localhost:9094 \
 *   LUNNOA_API_KEY=lna_... \
 *   LUNNOA_READONLY_API_KEY=lna_... \          # optional, check 8
 *   LUNNOA_SUPERADMIN_TOKEN=... \              # optional, check 16
 *   pnpm exec tsx scripts/sync-acceptance.ts
 *
 * Prints PASS/FAIL per check and exits 1 if any check fails.
 * Never prints API keys or the superadmin token.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const cliPath = join(repoRoot, 'dist', 'cli.js');

const baseUrl = requiredEnv('LUNNOA_URL').replace(/\/+$/, '');
const apiKey = requiredEnv('LUNNOA_API_KEY');
const readOnlyKey = process.env.LUNNOA_READONLY_API_KEY?.trim() || '';
const superadminToken = process.env.LUNNOA_SUPERADMIN_TOKEN?.trim() || '';
const secrets = [apiKey, readOnlyKey, superadminToken].filter((value) => value.length >= 8);

const stamp = `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;

const TEXT = 'text_action_template';
const HTTP = 'http_action_send-request';
const MANUAL = 'flow-control_trigger_manual';
const CONDITIONAL = 'flow-control_action_conditional-paths';
const FOR_EACH = 'flow-control_action_for-each';
const LOOP_COLLECTOR = 'flow-control_action_loop-collector';

interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
  output: string;
  leaked: boolean;
}

interface WorkflowNode {
  id: string;
  key?: string;
  nodeType?: string;
  actionId?: string;
  triggerId?: string;
  name?: string;
  position?: { x: number; y: number };
  value?: Record<string, unknown>;
  raw?: Record<string, unknown>;
  [key: string]: unknown;
}

interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  [key: string]: unknown;
}

interface CheckResult {
  name: string;
  ok: boolean;
  skipped?: boolean;
  detail: string;
}

const results: CheckResult[] = [];

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required env ${name}`);
  return value;
}

function redact(text: string): string {
  let out = text;
  for (const secret of secrets) out = out.split(secret).join('[redacted]');
  return out;
}

function containsSecret(text: string): boolean {
  return secrets.some((secret) => text.includes(secret));
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

function tipTap(text: string): Record<string, unknown> {
  return {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  };
}

class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
  }
}

async function api(
  method: string,
  path: string,
  options: { key?: string; token?: string; body?: unknown; ok?: boolean } = {},
): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  headers.authorization = `Bearer ${options.token ?? options.key ?? apiKey}`;
  const response = await fetch(new URL(path, baseUrl), {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (!response.ok && options.ok !== false) {
    const shown = redact(typeof body === 'string' ? body : JSON.stringify(body)).slice(0, 800);
    throw new ApiError(`${method} ${path} -> ${response.status} ${shown}`, response.status, body);
  }
  return { status: response.status, body };
}

function messageOf(body: unknown): string {
  if (!body || typeof body !== 'object') return '';
  const message = (body as { message?: unknown }).message;
  if (typeof message === 'string') return message;
  if (Array.isArray(message)) return message.filter((item) => typeof item === 'string').join('; ');
  return '';
}

function runCli(
  cwd: string,
  args: string[],
  envOverrides: Record<string, string> = {},
): Promise<CliResult> {
  return new Promise((resolvePromise, reject) => {
    const env: NodeJS.ProcessEnv = { ...process.env, LUNNOA_URL: baseUrl, LUNNOA_API_KEY: apiKey };
    delete env.LUNNOA_SUPERADMIN_TOKEN;
    delete env.LUNNOA_READONLY_API_KEY;
    Object.assign(env, envOverrides);
    const child = spawn(process.execPath, ['--experimental-strip-types', cliPath, ...args], {
      cwd,
      env,
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 120_000);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const output = `${stdout}\n${stderr}`;
      resolvePromise({
        code: code ?? 1,
        stdout,
        stderr,
        output,
        leaked: containsSecret(output),
      });
    });
  });
}

function assertOk(result: CliResult, what: string): void {
  if (result.leaked) throw new Error(`${what}: CLI output contained an API key or token`);
  if (result.code !== 0) {
    throw new Error(`${what} exited ${result.code}: ${redact(result.output).slice(0, 1600)}`);
  }
}

function assertRefused(result: CliResult, what: string, needle: string): void {
  if (result.leaked) throw new Error(`${what}: CLI output contained an API key or token`);
  if (result.code === 0) throw new Error(`${what} succeeded; expected a refusal`);
  if (!result.output.includes(needle)) {
    throw new Error(
      `${what} did not include "${needle}": ${redact(result.output).slice(0, 1600)}`,
    );
  }
}

async function makeProject(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'lunnoa-sync-'));
  await mkdir(join(dir, 'node_modules', '@lunnoa'), { recursive: true });
  await symlink(repoRoot, join(dir, 'node_modules', '@lunnoa', 'client'), 'dir');
  await writeFile(join(dir, 'package.json'), `${JSON.stringify({ type: 'module' })}\n`);
  return dir;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

function relKey(root: string, abs: string): string {
  return relative(root, abs).split(sep).join('/');
}

async function snapshot(root: string): Promise<Map<string, Buffer>> {
  const out = new Map<string, Buffer>();
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === 'node_modules') continue;
      const abs = join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        await walk(abs);
        continue;
      }
      if (entry.isFile()) out.set(relKey(root, abs), await readFile(abs));
    }
  }
  await walk(root);
  return out;
}

function changedFiles(before: Map<string, Buffer>, after: Map<string, Buffer>): string[] {
  const keys = new Set([...before.keys(), ...after.keys()]);
  const changed: string[] = [];
  for (const key of [...keys].sort()) {
    const left = before.get(key);
    const right = after.get(key);
    if (!left || !right || !left.equals(right)) changed.push(key);
  }
  return changed;
}

async function outsideLunnoa(root: string): Promise<string[]> {
  const files = await snapshot(root);
  return [...files.keys()].filter((key) => key !== 'package.json' && !key.startsWith('lunnoa/'));
}

function manualTrigger(id: string, extra: Record<string, unknown> = {}): WorkflowNode {
  return {
    id,
    nodeType: 'trigger',
    appId: 'flow-control',
    triggerId: MANUAL,
    name: 'Manually Run',
    description: 'Start the workflow manually',
    connectionId: '',
    position: { x: 80, y: 160 },
    value: {},
    raw: {},
    ...extra,
  };
}

function actionNode(options: {
  id: string;
  actionId: string;
  name: string;
  position: { x: number; y: number };
  value?: Record<string, unknown>;
  raw?: Record<string, unknown>;
  key?: string;
  description?: string;
  extra?: Record<string, unknown>;
}): WorkflowNode {
  const appId = options.actionId.slice(0, options.actionId.indexOf('_action_'));
  return {
    id: options.id,
    nodeType: 'action',
    appId,
    actionId: options.actionId,
    name: options.name,
    description: options.description ?? '',
    connectionId: '',
    position: options.position,
    value: options.value ?? {},
    raw: options.raw ?? {},
    ...(options.key ? { key: options.key } : {}),
    ...options.extra,
  };
}

function link(
  source: string,
  target: string,
  extra: Record<string, unknown> = {},
): WorkflowEdge {
  return { id: randomUUID(), source, target, type: 'workflow', ...extra };
}

async function createWorkflow(input: {
  slug: string;
  name: string;
  description?: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}): Promise<string> {
  const { body } = await api('POST', '/api/workflows', {
    body: {
      name: input.name,
      slug: input.slug,
      description: input.description ?? '',
      isActive: true,
      workflowOrientation: 'HORIZONTAL',
      nodes: input.nodes,
      edges: input.edges,
    },
  });
  const id = (body as { id?: string })?.id;
  assert(id, `POST /api/workflows did not return an id for ${input.slug}`);
  return id;
}

async function getWorkflow(id: string): Promise<Record<string, unknown>> {
  const { body } = await api(
    'GET',
    `/api/workflows/${id}?expansion=updatedAt,isActive,description,slug,codeSource,codeSyncStatus,nodes,edges`,
  );
  return body as Record<string, unknown>;
}

async function getAgent(id: string, expansion: string): Promise<Record<string, unknown>> {
  const { body } = await api('GET', `/api/agents/${id}?expansion=${expansion}`);
  return body as Record<string, unknown>;
}

async function workflowDefinition(slug: string): Promise<Record<string, unknown>> {
  const { body } = await api(
    'GET',
    `/api/workflows/slug/${encodeURIComponent(slug)}/definition`,
  );
  return body as Record<string, unknown>;
}

async function agentDefinition(slug: string): Promise<Record<string, unknown>> {
  const { body } = await api('GET', `/api/agents/slug/${encodeURIComponent(slug)}/definition`);
  return body as Record<string, unknown>;
}

function nodesOf(workflow: Record<string, unknown>): WorkflowNode[] {
  assert(Array.isArray(workflow.nodes), 'workflow response has no nodes');
  return workflow.nodes as WorkflowNode[];
}

function edgesOf(workflow: Record<string, unknown>): WorkflowEdge[] {
  assert(Array.isArray(workflow.edges), 'workflow response has no edges');
  return workflow.edges as WorkflowEdge[];
}

function byId<T extends { id: string }>(items: T[]): Map<string, T> {
  return new Map(items.map((item) => [item.id, item]));
}

function idsOf(nodes: WorkflowNode[]): string[] {
  return nodes.map((node) => node.id).sort();
}

function positionsOf(nodes: WorkflowNode[]): Record<string, { x: number; y: number } | undefined> {
  return Object.fromEntries(nodes.map((node) => [node.id, node.position]));
}

function keysOf(nodes: WorkflowNode[]): string[] {
  return nodes
    .filter((node) => node.nodeType !== 'placeholder')
    .map((node) => node.key ?? '')
    .sort();
}

function withoutKeys(nodes: WorkflowNode[]): WorkflowNode[] {
  return nodes.map((node) => {
    const copy = { ...node };
    delete copy.key;
    return copy;
  });
}

function findNode(nodes: WorkflowNode[], key: string): WorkflowNode {
  const node = nodes.find((item) => item.key === key);
  assert(node, `missing node key "${key}"`);
  return node;
}

function diffById(
  before: Array<{ id: string }>,
  after: Array<{ id: string }>,
  label: string,
): void {
  const left = byId(before);
  const right = byId(after);
  assert(
    stable([...left.keys()].sort()) === stable([...right.keys()].sort()),
    `${label} ids changed: ${[...left.keys()].sort().join(',')} -> ${[...right.keys()].sort().join(',')}`,
  );
  for (const [id, item] of left) {
    const next = right.get(id);
    if (stable(item) !== stable(next)) {
      const keys = new Set([
        ...Object.keys(item),
        ...Object.keys(next as object),
      ]);
      const parts: string[] = [];
      for (const key of keys) {
        const a = (item as Record<string, unknown>)[key];
        const b = (next as Record<string, unknown>)[key];
        if (stable(a) !== stable(b)) {
          parts.push(`${key}: ${JSON.stringify(a)?.slice(0, 180)} -> ${JSON.stringify(b)?.slice(0, 180)}`);
        }
      }
      throw new Error(`${label} ${id} changed (${parts.slice(0, 6).join('; ')})`);
    }
  }
}

async function record(name: string, fn: () => Promise<string | void>): Promise<boolean> {
  try {
    const detail = (await fn()) ?? '';
    if (containsSecret(detail)) throw new Error('check detail contained a secret');
    results.push({ name, ok: true, detail });
    console.log(`PASS  ${name}${detail ? ` — ${detail}` : ''}`);
    return true;
  } catch (error) {
    const detail = redact(error instanceof Error ? error.message : String(error)).slice(0, 2000);
    results.push({ name, ok: false, detail });
    console.log(`FAIL  ${name} — ${detail}`);
    return false;
  }
}

function skip(name: string, detail: string): void {
  results.push({ name, ok: true, skipped: true, detail });
  console.log(`SKIP  ${name} — ${detail}`);
}

interface Main {
  project: string;
  agentSlug: string;
  workflowSlug: string;
  agentId: string;
  workflowId: string;
  ready: boolean;
}

let modelId = '';

async function discoverModel(): Promise<void> {
  try {
    const { body } = await api('GET', '/api/ai-connections');
    const connections = Array.isArray(body) ? body : [];
    for (const connection of connections as Array<{ models?: Array<{ id?: string }> }>) {
      const model = connection.models?.find((item) => item.id);
      if (model?.id) {
        modelId = model.id;
        return;
      }
    }
  } catch {
    modelId = '';
  }
}

async function prepareMain(): Promise<Main> {
  const project = await makeProject();
  const agentSlug = `sa${stamp}-agent`;
  const workflowSlug = `sa${stamp}-flow`;
  const agentDir = join(project, 'lunnoa', 'agents');
  const workflowDir = join(project, 'lunnoa', 'workflows');
  await mkdir(agentDir, { recursive: true });
  await mkdir(workflowDir, { recursive: true });
  await writeFile(
    join(agentDir, `${agentSlug}.instructions.md`),
    'Follow the invoice through review.\n',
  );
  await writeJson(join(agentDir, `${agentSlug}.json`), {
    $schema: '../../node_modules/@lunnoa/client/schemas/agent.schema.json',
    kind: 'agent',
    slug: agentSlug,
    name: 'Sync agent',
    description: 'Acceptance agent',
    instructions: { file: `${agentSlug}.instructions.md` },
  });
  await writeJson(join(workflowDir, `${workflowSlug}.json`), {
    $schema: '../../node_modules/@lunnoa/client/schemas/workflow.schema.json',
    kind: 'workflow',
    format: 'steps',
    slug: workflowSlug,
    name: 'Sync workflow',
    description: 'Acceptance workflow',
    trigger: {
      id: MANUAL,
      name: 'Manually Run',
      description: 'Start the workflow manually',
    },
    steps: [
      {
        key: 'draft',
        name: 'Draft',
        description: 'Write the draft',
        use: { id: TEXT },
        input: { text: 'hello' },
      },
    ],
  });
  return {
    project,
    agentSlug,
    workflowSlug,
    agentId: '',
    workflowId: '',
    ready: false,
  };
}

async function main(): Promise<void> {
  console.log(`sync-acceptance ${stamp}`);
  await api('GET', '/api/code-sync/context');
  await discoverModel();
  if (superadminToken) await setLock(false);

  const mainProject = await prepareMain();

  const pushed = await record('1. first push rewrites files and writes the lock', async () => {
    const result = await runCli(mainProject.project, ['push']);
    assertOk(result, 'first push');
    const lockPath = join(mainProject.project, 'lunnoa', 'lunnoa.lock.json');
    const lock = await readJson<{ version?: number; deployments?: unknown }>(lockPath);
    assert(lock.version === 1 && lock.deployments, 'lock file was not written');
    const agentFile = await readJson<Record<string, unknown>>(
      join(mainProject.project, 'lunnoa', 'agents', `${mainProject.agentSlug}.json`),
    );
    const workflowFile = await readJson<Record<string, unknown>>(
      join(mainProject.project, 'lunnoa', 'workflows', `${mainProject.workflowSlug}.json`),
    );
    assert(typeof agentFile.$schema === 'string', 'agent file is missing $schema');
    assert(agentFile.settings && typeof agentFile.settings === 'object', 'agent file was not rewritten with settings');
    assert(
      (agentFile.instructions as { file?: string })?.file === `${mainProject.agentSlug}.instructions.md`,
      'agent instructions were not kept in the markdown file',
    );
    assert(workflowFile.format === 'steps', `workflow was rewritten as ${String(workflowFile.format)}`);
    assert(typeof workflowFile.$schema === 'string', 'workflow file is missing $schema');
    const instructions = await readFile(
      join(mainProject.project, 'lunnoa', 'agents', `${mainProject.agentSlug}.instructions.md`),
      'utf8',
    );
    assert(instructions.includes('Follow the invoice'), 'instructions file was not rewritten from the stored definition');
    const agent = await agentDefinition(mainProject.agentSlug);
    const workflow = await workflowDefinition(mainProject.workflowSlug);
    mainProject.agentId = String(agent.id);
    mainProject.workflowId = String(workflow.id);
    mainProject.ready = true;
    return `${mainProject.agentSlug} + ${mainProject.workflowSlug}`;
  });
  if (!pushed) mainProject.ready = false;

  await record('2. pull right after push changes no files', async () => {
    assert(mainProject.ready, 'check 1 did not pass');
    const before = await snapshot(join(mainProject.project, 'lunnoa'));
    const result = await runCli(mainProject.project, ['pull']);
    assertOk(result, 'pull');
    const after = await snapshot(join(mainProject.project, 'lunnoa'));
    const changed = changedFiles(before, after);
    assert(changed.length === 0, `pull changed ${changed.join(', ') || 'files'}`);
    return `${before.size} files unchanged`;
  });

  await record('3. pushing the same files changes nothing', async () => {
    assert(mainProject.ready, 'check 1 did not pass');
    const workflowBefore = await getWorkflow(mainProject.workflowId);
    const agentBefore = await getAgent(
      mainProject.agentId,
      'updatedAt,codeSyncStatus,codeSource',
    );
    const definitionBefore = await workflowDefinition(mainProject.workflowSlug);
    const agentDefBefore = await agentDefinition(mainProject.agentSlug);
    const result = await runCli(mainProject.project, ['push']);
    assertOk(result, 'second push');
    const workflowAfter = await getWorkflow(mainProject.workflowId);
    const agentAfter = await getAgent(mainProject.agentId, 'updatedAt,codeSyncStatus');
    const definitionAfter = await workflowDefinition(mainProject.workflowSlug);
    const agentDefAfter = await agentDefinition(mainProject.agentSlug);
    assert(
      definitionAfter.revision === definitionBefore.revision,
      `workflow revision changed ${definitionBefore.revision} -> ${definitionAfter.revision}`,
    );
    assert(
      agentDefAfter.revision === agentDefBefore.revision,
      `agent revision changed ${agentDefBefore.revision} -> ${agentDefAfter.revision}`,
    );
    assert(
      stable(idsOf(nodesOf(workflowBefore))) === stable(idsOf(nodesOf(workflowAfter))),
      'workflow node ids changed on a no-op push',
    );
    const workflowUntouched = workflowBefore.updatedAt === workflowAfter.updatedAt;
    const agentUntouched = agentBefore.updatedAt === agentAfter.updatedAt;
    return workflowUntouched && agentUntouched
      ? 'revision, node ids and updatedAt unchanged'
      : 'revision and node ids unchanged';
  });

  await record('4. UI instruction edit, status, pull, push', async () => {
    assert(mainProject.ready, 'check 1 did not pass');
    await api('PATCH', `/api/agents/${mainProject.agentId}`, {
      body: { instructions: 'Follow the invoice through review. UI edit.' },
    });
    const beforePush = await getAgent(
      mainProject.agentId,
      'codeSyncStatus,codeSource,instructions',
    );
    assert(beforePush.codeSyncStatus === 'changed_in_ui', `codeSyncStatus is ${String(beforePush.codeSyncStatus)} before push`);
    const status = await runCli(mainProject.project, ['status', '--json']);
    assertOk(status, 'status');
    const rows = JSON.parse(status.stdout) as Array<{ kind: string; slug: string; remote: string }>;
    const row = rows.find((item) => item.kind === 'agent' && item.slug === mainProject.agentSlug);
    assert(row, 'status did not list the agent');
    assert(row.remote === 'changed in UI', `status remote is "${row.remote}"`);
    const before = await snapshot(join(mainProject.project, 'lunnoa'));
    const pulled = await runCli(mainProject.project, ['pull']);
    assertOk(pulled, 'pull after UI edit');
    const after = await snapshot(join(mainProject.project, 'lunnoa'));
    const changed = changedFiles(before, after);
    const allowed = new Set([
      `agents/${mainProject.agentSlug}.json`,
      `agents/${mainProject.agentSlug}.instructions.md`,
      'lunnoa.lock.json',
    ]);
    const unexpected = changed.filter((file) => !allowed.has(file));
    assert(unexpected.length === 0, `pull changed unexpected files: ${unexpected.join(', ')}`);
    assert(
      changed.some((file) => file.startsWith('agents/')),
      'pull did not change the agent files',
    );
    const instructions = await readFile(
      join(mainProject.project, 'lunnoa', 'agents', `${mainProject.agentSlug}.instructions.md`),
      'utf8',
    );
    assert(instructions.includes('UI edit'), 'pulled instructions do not contain the UI edit');
    const pushedBack = await runCli(mainProject.project, ['push', `agents/${mainProject.agentSlug}`]);
    assertOk(pushedBack, 'push after pull');
    const afterPush = await getAgent(mainProject.agentId, 'codeSyncStatus,instructions');
    assert(afterPush.codeSyncStatus === 'in_sync', `codeSyncStatus is ${String(afterPush.codeSyncStatus)} after push`);
    return 'changed_in_ui then in_sync';
  });

  await record('5. builder save keeps keys and round-trips', async () => {
    assert(mainProject.ready, 'check 1 did not pass');
    const before = await getWorkflow(mainProject.workflowId);
    const originalKeys = keysOf(nodesOf(before));
    assert(originalKeys.includes('trigger') && originalKeys.includes('draft'), `keys before edit: ${originalKeys.join(', ')}`);
    const nodes = withoutKeys(clone(nodesOf(before)));
    const draft = nodes.find((node) => node.actionId === TEXT);
    assert(draft, 'draft step is missing');
    draft.value = { ...(draft.value ?? {}), text: 'ui-step-edit' };
    draft.raw = { ...(draft.raw ?? {}), text: tipTap('ui-step-edit') };
    await api('PATCH', `/api/workflows/${mainProject.workflowId}`, {
      body: { nodes, edges: edgesOf(before) },
    });
    const edited = await getWorkflow(mainProject.workflowId);
    assert(stable(keysOf(nodesOf(edited))) === stable(originalKeys), `keys changed ${originalKeys.join(',')} -> ${keysOf(nodesOf(edited)).join(',')}`);
    const marker = findNode(nodesOf(edited), 'draft');
    assert(marker.value?.text === 'ui-step-edit', 'UI step edit was not stored');
    const filesBefore = await snapshot(join(mainProject.project, 'lunnoa'));
    const pulled = await runCli(mainProject.project, ['pull']);
    assertOk(pulled, 'pull after builder save');
    const filesAfter = await snapshot(join(mainProject.project, 'lunnoa'));
    const changed = changedFiles(filesBefore, filesAfter);
    assert(
      changed.includes(`workflows/${mainProject.workflowSlug}.json`),
      `pull did not update the workflow file (changed: ${changed.join(', ') || 'nothing'})`,
    );
    const agentChanged = changed.filter((file) => file.startsWith('agents/'));
    assert(agentChanged.length === 0, `pull also changed ${agentChanged.join(', ')}`);
    const pulledFile = await readJson<{ steps?: Array<{ input?: { text?: string } }> }>(
      join(mainProject.project, 'lunnoa', 'workflows', `${mainProject.workflowSlug}.json`),
    );
    assert(
      JSON.stringify(pulledFile).includes('ui-step-edit'),
      'pulled workflow file does not contain the edited step value',
    );
    const revision = (await workflowDefinition(mainProject.workflowSlug)).revision;
    const ids = idsOf(nodesOf(edited));
    const positions = positionsOf(nodesOf(edited));
    const pushedBack = await runCli(mainProject.project, ['push', `workflows/${mainProject.workflowSlug}`]);
    assertOk(pushedBack, 'push of the pulled workflow');
    const again = await getWorkflow(mainProject.workflowId);
    const againDef = await workflowDefinition(mainProject.workflowSlug);
    assert(stable(idsOf(nodesOf(again))) === stable(ids), 'node ids changed when pushing the pulled file');
    assert(stable(positionsOf(nodesOf(again))) === stable(positions), 'positions changed when pushing the pulled file');
    assert(againDef.revision === revision, `revision changed ${revision} -> ${againDef.revision}`);
    return 'keys kept; second push is a no-op';
  });

  await record('6. stale push is refused; --force writes', async () => {
    assert(mainProject.ready, 'check 1 did not pass');
    const current = await getWorkflow(mainProject.workflowId);
    const nodes = withoutKeys(clone(nodesOf(current)));
    const draft = nodes.find((node) => node.key === undefined && node.actionId === TEXT) ?? nodes.find((node) => node.actionId === TEXT);
    assert(draft, 'draft step is missing');
    draft.value = { ...(draft.value ?? {}), text: 'from-ui' };
    draft.raw = { ...(draft.raw ?? {}), text: tipTap('from-ui') };
    await api('PATCH', `/api/workflows/${mainProject.workflowId}`, {
      body: { nodes, edges: edgesOf(current) },
    });
    const stamped = await getWorkflow(mainProject.workflowId);
    const filePath = join(mainProject.project, 'lunnoa', 'workflows', `${mainProject.workflowSlug}.json`);
    const file = await readJson<{ steps: Array<{ key?: string; input?: Record<string, unknown> }> }>(filePath);
    const step = file.steps.find((item) => item.key === 'draft') ?? file.steps[0];
    assert(step, 'draft step missing from the file');
    step.input = { ...(step.input ?? {}), text: 'from-code' };
    await writeJson(filePath, file);
    const refused = await runCli(mainProject.project, ['push', `workflows/${mainProject.workflowSlug}`]);
    assertRefused(refused, 'stale push', 'Changed in the UI since your last pull. Run pull first.');
    const afterRefusal = await getWorkflow(mainProject.workflowId);
    assert(afterRefusal.updatedAt === stamped.updatedAt, 'refused push wrote to the workflow');
    assert(findNode(nodesOf(afterRefusal), 'draft').value?.text === 'from-ui', 'refused push replaced the UI value');
    const forced = await runCli(mainProject.project, ['push', `workflows/${mainProject.workflowSlug}`, '--force']);
    assertOk(forced, 'push --force');
    const afterForce = await getWorkflow(mainProject.workflowId);
    assert(findNode(nodesOf(afterForce), 'draft').value?.text === 'from-code', 'force push did not store the local step value');
    return 'refused, then --force stored from-code';
  });

  await record('7. first push of an existing slug is refused unless --force', async () => {
    const slug = `sa${stamp}-exists`;
    const triggerId = randomUUID();
    const stepId = randomUUID();
    await createWorkflow({
      slug,
      name: 'Already there',
      description: 'Created in the UI',
      nodes: [
        manualTrigger(triggerId),
        actionNode({
          id: stepId,
          actionId: TEXT,
          name: 'Draft',
          position: { x: 360, y: 160 },
          value: { text: 'ui-original' },
          raw: { text: tipTap('ui-original') },
        }),
      ],
      edges: [link(triggerId, stepId)],
    });
    const project = await makeProject();
    await writeJson(join(project, 'lunnoa', 'workflows', `${slug}.json`), {
      $schema: '../../node_modules/@lunnoa/client/schemas/workflow.schema.json',
      kind: 'workflow',
      format: 'steps',
      slug,
      name: 'Already there',
      description: 'Created in the UI',
      trigger: { id: MANUAL, name: 'Manually Run' },
      steps: [{ key: 'draft', name: 'Draft', use: { id: TEXT }, input: { text: 'from-file' } }],
    });
    const created = await workflowDefinition(slug);
    const before = await getWorkflow(String(created.id));
    const refused = await runCli(project, ['push', `workflows/${slug}`]);
    assertRefused(refused, 'first push', `A workflow with slug "${slug}" already exists in Lunnoa. Run pull first, or push with --force.`);
    const after = await getWorkflow(String(created.id));
    assert(after.updatedAt === before.updatedAt, 'refused first push wrote the workflow');
    assert(JSON.stringify(nodesOf(after)).includes('ui-original'), 'refused first push replaced the UI workflow');
    const forced = await runCli(project, ['push', `workflows/${slug}`, '--force']);
    assertOk(forced, 'push --force');
    const stored = await getWorkflow(String(created.id));
    assert(JSON.stringify(nodesOf(stored)).includes('from-file'), '--force did not store the file');
    return slug;
  });

  if (!readOnlyKey) {
    skip('8. read-only pull is GET-only and cannot escape lunnoa/', 'LUNNOA_READONLY_API_KEY is not set');
  } else await record('8. read-only pull is GET-only and cannot escape lunnoa/', async () => {
    assert(mainProject.ready, 'check 1 did not pass');
    const project = await makeProject();
    const proxy = await startProxy(baseUrl);
    try {
      const pulled = await runCli(
        project,
        ['pull', `workflows/${mainProject.workflowSlug}`],
        { LUNNOA_URL: proxy.url, LUNNOA_API_KEY: readOnlyKey },
      );
      assertOk(pulled, 'viewer pull');
      const methods = proxy.methods.map((line) => line.split(' ')[0]);
      assert(methods.length > 0, 'viewer pull made no HTTP requests');
      const writes = methods.filter((method) => method !== 'GET' && method !== 'HEAD');
      assert(writes.length === 0, `viewer pull issued ${writes.join(', ') || 'a write'}: ${proxy.methods.join('; ')}`);
      const written = await readFile(
        join(project, 'lunnoa', 'workflows', `${mainProject.workflowSlug}.json`),
        'utf8',
      );
      assert(written.includes(mainProject.workflowSlug), 'viewer pull did not write the workflow file');
      const outside = await outsideLunnoa(project);
      assert(outside.length === 0, `pull wrote outside lunnoa/: ${outside.join(', ')}`);
      const beforeEvil = await snapshot(project);
      const evil = await runCli(project, ['pull', '../evil'], {
        LUNNOA_URL: proxy.url,
        LUNNOA_API_KEY: readOnlyKey,
      });
      if (evil.leaked) throw new Error('path-traversal pull output contained a secret');
      assert(evil.code !== 0, 'pull ../evil was accepted');
      const afterEvil = await snapshot(project);
      const escaped = changedFiles(beforeEvil, afterEvil).filter((file) => !file.startsWith('lunnoa/'));
      assert(escaped.length === 0, `pull ../evil wrote ${escaped.join(', ')}`);
      assert(!(await pathExists(join(project, 'evil'))), 'pull wrote evil at the project root');
      return `${methods.length} GETs; ../evil rejected`;
    } finally {
      await proxy.close();
    }
  });

  await record('9. UI loop pulls as graph and pushes back losslessly', async () => {
    const slug = `sa${stamp}-loop`;
    const triggerId = randomUUID();
    const eachId = randomUUID();
    const bodyId = randomUUID();
    const collectorId = randomUUID();
    const afterId = randomUUID();
    const id = await createWorkflow({
      slug,
      name: 'Loop from the builder',
      description: 'For each row',
      nodes: [
        manualTrigger(triggerId, { position: { x: 40, y: 80 } }),
        actionNode({
          id: eachId,
          actionId: FOR_EACH,
          name: 'Each row',
          position: { x: 300, y: 80 },
          value: { listToIterate: 'a,b', batchSize: 1 },
          raw: { listToIterate: tipTap('a,b'), batchSize: 1 },
        }),
        actionNode({
          id: bodyId,
          actionId: TEXT,
          name: 'Handle row',
          position: { x: 560, y: 220 },
          value: { text: 'handle' },
          raw: { text: tipTap('handle') },
          description: 'Handles one row',
          extra: {
            retrySettings: { enabled: true, maxAttempts: 3, delaySeconds: 5 },
            references: { from: 'ui' },
          },
        }),
        actionNode({
          id: collectorId,
          actionId: LOOP_COLLECTOR,
          name: 'Collect',
          position: { x: 820, y: 80 },
          value: { aggregationMode: 'array' },
          raw: { aggregationMode: 'array' },
        }),
        actionNode({
          id: afterId,
          actionId: TEXT,
          name: 'After',
          position: { x: 1080, y: 80 },
          value: { text: 'done' },
          raw: { text: tipTap('done') },
        }),
      ],
      edges: [
        link(triggerId, eachId, { animated: true }),
        link(eachId, bodyId, { animated: true }),
        link(bodyId, collectorId, { animated: true }),
        link(collectorId, eachId, { animated: true }),
        link(eachId, afterId, { animated: true }),
      ],
    });
    const stored = await getWorkflow(id);
    assert(keysOf(nodesOf(stored)).every((key) => key.length > 0), 'create did not assign node keys');
    const project = await makeProject();
    const pulled = await runCli(project, ['pull', `workflows/${slug}`]);
    assertOk(pulled, 'pull loop');
    const file = await readJson<{ format?: string }>(
      join(project, 'lunnoa', 'workflows', `${slug}.json`),
    );
    assert(file.format === 'graph', `pull format is ${String(file.format)}, expected graph`);
    const pushedBack = await runCli(project, ['push', `workflows/${slug}`]);
    assertOk(pushedBack, 'push loop');
    const again = await getWorkflow(id);
    diffById(nodesOf(stored), nodesOf(again), 'loop node');
    diffById(edgesOf(stored), edgesOf(again), 'loop edge');
    return 'graph round-trip kept nodes, edges, positions and raw';
  });

  await record('10. UI conditional pulls as steps and keeps ids and positions', async () => {
    const slug = `sa${stamp}-branch`;
    const triggerId = randomUUID();
    const loadId = randomUUID();
    const routeId = randomUUID();
    const applyId = randomUUID();
    const skipId = randomUUID();
    const largeEdge = randomUUID();
    const otherEdge = randomUUID();
    const filters = [
      {
        label: 'Large',
        pathId: largeEdge,
        filters: {
          operator: 'OR',
          filters: [
            [
              {
                refValue: `={{ref:${loadId},amount}}`,
                fieldId: `${loadId},amount`,
                condition: 'is_greater_than',
                value: '1000',
                label: 'Load amount',
              },
            ],
          ],
        },
      },
      {
        label: 'Other',
        pathId: otherEdge,
        filters: { operator: 'OR', filters: [] },
      },
    ];
    const id = await createWorkflow({
      slug,
      name: 'Branch from the builder',
      description: 'Route by amount',
      nodes: [
        manualTrigger(triggerId, { key: 'trigger', position: { x: 48, y: 96 } }),
        actionNode({
          id: loadId,
          key: 'load',
          actionId: HTTP,
          name: 'Load',
          position: { x: 280, y: 96 },
          value: { method: 'GET', url: 'https://example.test/invoice' },
          raw: { method: 'GET', url: tipTap('https://example.test/invoice') },
        }),
        actionNode({
          id: routeId,
          key: 'route',
          actionId: CONDITIONAL,
          name: 'Route',
          position: { x: 520, y: 96 },
          value: { conditionalPathsLunnoaFilters: filters },
          raw: { conditionalPathsLunnoaFilters: filters },
        }),
        actionNode({
          id: applyId,
          key: 'apply',
          actionId: TEXT,
          name: 'Apply',
          position: { x: 780, y: 40 },
          value: { text: 'apply' },
          raw: { text: tipTap('apply') },
        }),
        actionNode({
          id: skipId,
          key: 'skip',
          actionId: TEXT,
          name: 'Skip',
          position: { x: 780, y: 220 },
          value: { text: 'skip' },
          raw: { text: tipTap('skip') },
        }),
      ],
      edges: [
        link(triggerId, loadId),
        link(loadId, routeId),
        { id: largeEdge, source: routeId, target: applyId, type: 'workflow' },
        { id: otherEdge, source: routeId, target: skipId, type: 'workflow' },
      ],
    });
    const stored = await getWorkflow(id);
    const project = await makeProject();
    const pulled = await runCli(project, ['pull', `workflows/${slug}`]);
    assertOk(pulled, 'pull branch');
    const file = await readJson<{ format?: string; steps?: unknown[] }>(
      join(project, 'lunnoa', 'workflows', `${slug}.json`),
    );
    assert(file.format === 'steps', `pull format is ${String(file.format)}, expected steps`);
    assert(Array.isArray(file.steps) && file.steps.length > 0, 'steps file has no steps');
    const pushedBack = await runCli(project, ['push', `workflows/${slug}`]);
    assertOk(pushedBack, 'push branch');
    const again = await getWorkflow(id);
    assert(stable(idsOf(nodesOf(stored))) === stable(idsOf(nodesOf(again))), 'conditional round-trip changed node ids');
    assert(
      stable(positionsOf(nodesOf(stored))) === stable(positionsOf(nodesOf(again))),
      'conditional round-trip changed positions',
    );
    diffById(nodesOf(stored), nodesOf(again), 'branch node');
    diffById(edgesOf(stored), edgesOf(again), 'branch edge');
    return 'steps round-trip kept ids, positions, raw and edges';
  });

  await record('11. position and isActive do not change revision or badge', async () => {
    assert(mainProject.ready, 'check 1 did not pass');
    const before = await getWorkflow(mainProject.workflowId);
    const beforeDef = await workflowDefinition(mainProject.workflowSlug);
    assert(before.codeSyncStatus === 'in_sync', `badge is ${String(before.codeSyncStatus)} before the move`);
    const nodes = clone(nodesOf(before));
    const moving = nodes.find((node) => node.nodeType === 'action');
    assert(moving?.position, 'action node has no position');
    moving.position = { x: moving.position.x + 40, y: moving.position.y };
    await api('PATCH', `/api/workflows/${mainProject.workflowId}`, {
      body: { nodes, edges: edgesOf(before) },
    });
    const moved = await getWorkflow(mainProject.workflowId);
    const movedDef = await workflowDefinition(mainProject.workflowSlug);
    assert(movedDef.revision === beforeDef.revision, `position move changed revision ${beforeDef.revision} -> ${movedDef.revision}`);
    assert(moved.codeSyncStatus === 'in_sync', `badge is ${String(moved.codeSyncStatus)} after the move`);
    assert(findNode(nodesOf(moved), 'draft').position?.x === moving.position.x, 'position was not saved');
    const active = moved.isActive !== false;
    await api('PATCH', `/api/workflows/${mainProject.workflowId}`, {
      body: { isActive: !active },
    });
    const toggled = await getWorkflow(mainProject.workflowId);
    const toggledDef = await workflowDefinition(mainProject.workflowSlug);
    assert(toggled.isActive === !active, 'isActive did not change');
    assert(toggledDef.revision === beforeDef.revision, 'isActive change changed the revision');
    assert(toggled.codeSyncStatus === 'in_sync', `badge is ${String(toggled.codeSyncStatus)} after isActive`);
    await api('PATCH', `/api/workflows/${mainProject.workflowId}`, { body: { isActive: active } });
    return 'in_sync held';
  });

  await record('12. trigger config mints a new id; action change keeps the step id', async () => {
    assert(mainProject.ready, 'check 1 did not pass');
    const before = nodesOf(await getWorkflow(mainProject.workflowId));
    const triggerBefore = findNode(before, 'trigger').id;
    const stepBefore = findNode(before, 'draft').id;
    const filePath = join(mainProject.project, 'lunnoa', 'workflows', `${mainProject.workflowSlug}.json`);
    const file = await readJson<{
      format?: string;
      trigger?: { inputs?: unknown[]; input?: Record<string, unknown> };
      steps?: Array<{ key?: string; use?: { id?: string } }>;
    }>(filePath);
    assert(file.format === 'steps', `workflow file format is ${String(file.format)}`);
    assert(file.trigger, 'workflow file has no trigger');
    file.trigger.inputs = [{ id: 'note', label: 'Note', required: true }];
    await writeJson(filePath, file);
    const pushedTrigger = await runCli(mainProject.project, ['push', `workflows/${mainProject.workflowSlug}`]);
    assertOk(pushedTrigger, 'push trigger config');
    const mid = nodesOf(await getWorkflow(mainProject.workflowId));
    assert(findNode(mid, 'trigger').id !== triggerBefore, 'trigger id was kept after its configuration changed');
    assert(findNode(mid, 'draft').id === stepBefore, 'step id changed when the trigger configuration changed');
    const rewritten = await readJson<{ steps: Array<{ key?: string; use?: { id?: string } }> }>(filePath);
    const step = rewritten.steps.find((item) => item.key === 'draft');
    assert(step?.use, 'draft step missing after trigger push');
    step.use.id = HTTP;
    await writeJson(filePath, rewritten);
    const pushedAction = await runCli(mainProject.project, ['push', `workflows/${mainProject.workflowSlug}`]);
    assertOk(pushedAction, 'push step action');
    const after = nodesOf(await getWorkflow(mainProject.workflowId));
    const draft = findNode(after, 'draft');
    assert(draft.id === stepBefore, `step id changed ${stepBefore} -> ${draft.id} when its action changed`);
    assert(draft.actionId === HTTP, `step action is ${String(draft.actionId)}`);
    return 'trigger id replaced; draft id kept';
  });

  await record('13. omitted settings do not change discovery flags', async () => {
    assert(mainProject.ready, 'check 1 did not pass');
    await api('PATCH', `/api/agents/${mainProject.agentId}`, {
      body: {
        dynamicActionDiscoveryEnabled: true,
        dynamicMcpDiscoveryEnabled: true,
        dynamicSelfInstructionsEnabled: true,
      },
    });
    const pulled = await runCli(mainProject.project, ['pull', `agents/${mainProject.agentSlug}`]);
    assertOk(pulled, 'pull agent settings');
    const agentPath = join(mainProject.project, 'lunnoa', 'agents', `${mainProject.agentSlug}.json`);
    const agentFile = await readJson<Record<string, unknown>>(agentPath);
    delete agentFile.settings;
    await writeJson(agentPath, agentFile);
    const pushed = await runCli(mainProject.project, ['push', `agents/${mainProject.agentSlug}`]);
    assertOk(pushed, 'push without settings');
    const stored = await getAgent(
      mainProject.agentId,
      'dynamicActionDiscoveryEnabled,dynamicMcpDiscoveryEnabled,dynamicSelfInstructionsEnabled',
    );
    assert(stored.dynamicActionDiscoveryEnabled === true, 'dynamicActionDiscoveryEnabled changed');
    assert(stored.dynamicMcpDiscoveryEnabled === true, 'dynamicMcpDiscoveryEnabled changed');
    assert(stored.dynamicSelfInstructionsEnabled === true, 'dynamicSelfInstructionsEnabled changed');

    assert(modelId, 'no AI model is available for the TypeScript deploy check');
    const slug = `sa${stamp}-gen-agent`;
    const project = await makeProject();
    const source = join(project, 'agent.ts');
    await writeFile(
      source,
      `import { defineAgent } from '@lunnoa/client';

export default defineAgent({
  slug: ${JSON.stringify(slug)},
  name: 'Generated helper',
  model: ${JSON.stringify(modelId)},
  instructions: 'Generated instructions.',
});
`,
    );
    const first = await runCli(project, ['agents', 'deploy', source]);
    assertOk(first, 'agents deploy');
    const created = await agentDefinition(slug);
    // Generated agents reject UI patches. A later code deploy is what sets the flags.
    await api('POST', '/api/agents/upsert', {
      body: {
        slug,
        name: 'Generated helper',
        instructions: 'Generated instructions.',
        model: modelId,
        codeSource: 'generated',
        settings: {
          dynamicActionDiscoveryEnabled: true,
          dynamicMcpDiscoveryEnabled: true,
          dynamicSelfInstructionsEnabled: true,
        },
      },
    });
    const second = await runCli(project, ['agents', 'deploy', source]);
    assertOk(second, 'agents deploy again');
    const after = await getAgent(
      String(created.id),
      'dynamicActionDiscoveryEnabled,dynamicMcpDiscoveryEnabled,dynamicSelfInstructionsEnabled,codeSource',
    );
    assert(after.dynamicActionDiscoveryEnabled === true, 'TS deploy cleared dynamicActionDiscoveryEnabled');
    assert(after.dynamicMcpDiscoveryEnabled === true, 'TS deploy cleared dynamicMcpDiscoveryEnabled');
    assert(after.dynamicSelfInstructionsEnabled === true, 'TS deploy cleared dynamicSelfInstructionsEnabled');
    return 'file push and TypeScript deploy left the flags on';
  });

  await record('14. pull warns on literal secrets and never prints the API key', async () => {
    const slug = `sa${stamp}-secret`;
    const project = await makeProject();
    await writeJson(join(project, 'lunnoa', 'workflows', `${slug}.json`), {
      $schema: '../../node_modules/@lunnoa/client/schemas/workflow.schema.json',
      kind: 'workflow',
      format: 'steps',
      slug,
      name: 'Secret step',
      trigger: { id: MANUAL, name: 'Manually Run' },
      steps: [
        {
          key: 'call',
          name: 'Call',
          use: { id: HTTP },
          input: { method: 'GET', url: 'https://example.test', apiKey: 'literal-secret-value', authorization: 'Bearer literal' },
        },
      ],
    });
    const pushed = await runCli(project, ['push', `workflows/${slug}`]);
    assertOk(pushed, 'push secret workflow');
    const fresh = await makeProject();
    const pulled = await runCli(fresh, ['pull', `workflows/${slug}`]);
    assertOk(pulled, 'pull secret workflow');
    if (pulled.leaked || pushed.leaked) throw new Error('CLI output contained an API key or token');
    assert(/looks like a secret/i.test(pulled.stderr), `pull did not warn: ${redact(pulled.output).slice(0, 800)}`);
    assert(/apiKey|authorization/i.test(pulled.stderr), 'warning did not name the secret field');
    const file = await readFile(join(fresh, 'lunnoa', 'workflows', `${slug}.json`), 'utf8');
    assert(file.includes('apiKey'), 'pulled definition dropped the apiKey field');
    return 'warned without printing the API key';
  });

  await record('15. TypeScript workflow is generated and locked', async () => {
    const slug = `sa${stamp}-generated`;
    const project = await makeProject();
    const source = join(project, 'workflow.ts');
    await writeFile(
      source,
      `import { defineAction, defineWorkflow } from '@lunnoa/client';

export default defineWorkflow({
  slug: ${JSON.stringify(slug)},
  name: 'Generated workflow',
  description: 'Deployed from TypeScript',
  steps: [
    {
      name: 'Draft',
      use: defineAction({ id: ${JSON.stringify(TEXT)} }),
      input: { text: 'generated' },
    },
  ],
});
`,
    );
    const deployed = await runCli(project, ['workflows', 'deploy', source]);
    assertOk(deployed, 'workflows deploy');
    const definition = await workflowDefinition(slug);
    assert(definition.codeSource === 'generated', `codeSource is ${String(definition.codeSource)}`);
    assert(!hasKey(definition, 'managedByCode'), 'definition response still has managedByCode');
    const id = String(definition.id);
    const loaded = await getWorkflow(id);
    assert(loaded.codeSource === 'generated', `GET codeSource is ${String(loaded.codeSource)}`);
    assert(!hasKey(loaded, 'managedByCode'), 'GET workflow still has managedByCode');
    const patched = await api('PATCH', `/api/workflows/${id}`, {
      ok: false,
      body: { name: 'Renamed in the UI' },
    });
    assert(patched.status === 409, `PATCH returned ${patched.status}`);
    assert(
      messageOf(patched.body).includes('managed by code'),
      `PATCH message was ${messageOf(patched.body)}`,
    );
    return slug;
  });

  if (!superadminToken) {
    skip('16. workspace lock blocks UI edits and still allows push', 'LUNNOA_SUPERADMIN_TOKEN is not set');
  } else await record('16. workspace lock blocks UI edits and still allows push', async () => {
    assert(mainProject.ready, 'check 1 did not pass');
    const context = await api('GET', '/api/code-sync/context');
    const workspaceId = String((context.body as { workspaceId?: string }).workspaceId ?? '');
    assert(workspaceId, 'code-sync context has no workspaceId');
    try {
      await setLock(true, workspaceId);
      const workflowPatch = await api('PATCH', `/api/workflows/${mainProject.workflowId}`, {
        ok: false,
        body: { description: 'edited while locked' },
      });
      assert(workflowPatch.status === 409, `workflow PATCH returned ${workflowPatch.status}`);
      assert(
        messageOf(workflowPatch.body).includes('synced with code'),
        `workflow lock message was ${messageOf(workflowPatch.body)}`,
      );
      const agentPatch = await api('PATCH', `/api/agents/${mainProject.agentId}`, {
        ok: false,
        body: { instructions: 'edited while locked' },
      });
      assert(agentPatch.status === 409, `agent PATCH returned ${agentPatch.status}`);
      assert(
        messageOf(agentPatch.body).includes('synced with code'),
        `agent lock message was ${messageOf(agentPatch.body)}`,
      );
      const workflow = await getWorkflow(mainProject.workflowId);
      const agent = await getAgent(mainProject.agentId, 'codeSyncStatus,codeSource');
      assert(workflow.codeSyncStatus === 'locked', `workflow badge is ${String(workflow.codeSyncStatus)}`);
      assert(agent.codeSyncStatus === 'locked', `agent badge is ${String(agent.codeSyncStatus)}`);
      const filePath = join(mainProject.project, 'lunnoa', 'workflows', `${mainProject.workflowSlug}.json`);
      const file = await readJson<{ steps: Array<{ key?: string; input?: Record<string, unknown> }> }>(filePath);
      const step = file.steps.find((item) => item.key === 'draft') ?? file.steps[0];
      assert(step, 'draft step missing');
      step.input = { ...(step.input ?? {}), text: 'pushed-while-locked' };
      await writeJson(filePath, file);
      const pushed = await runCli(mainProject.project, ['push', `workflows/${mainProject.workflowSlug}`]);
      assertOk(pushed, 'push while locked');
      const stored = await getWorkflow(mainProject.workflowId);
      assert(
        findNode(nodesOf(stored), 'draft').value?.text === 'pushed-while-locked',
        'push while locked did not store the step',
      );
      return 'UI refused, push stored the step';
    } finally {
      await setLock(false, workspaceId);
    }
  });

  await record('17. clearing description (and model) round-trips with no diff', async () => {
    assert(mainProject.ready, 'check 1 did not pass');
    const workflowPath = join(mainProject.project, 'lunnoa', 'workflows', `${mainProject.workflowSlug}.json`);
    const agentPath = join(mainProject.project, 'lunnoa', 'agents', `${mainProject.agentSlug}.json`);
    const workflowFile = await readJson<Record<string, unknown>>(workflowPath);
    assert('description' in workflowFile, 'workflow file has no description to remove');
    delete workflowFile.description;
    await writeJson(workflowPath, workflowFile);
    const pushedWorkflow = await runCli(mainProject.project, ['push', `workflows/${mainProject.workflowSlug}`]);
    assertOk(pushedWorkflow, 'push workflow without description');
    const storedWorkflow = await getWorkflow(mainProject.workflowId);
    assert(
      storedWorkflow.description == null || storedWorkflow.description === '',
      `workflow description is ${JSON.stringify(storedWorkflow.description)}`,
    );
    await assertPullClean(mainProject.project, 'workflow description');

    const agentFile = await readJson<Record<string, unknown>>(agentPath);
    if (modelId) {
      agentFile.model = modelId;
      agentFile.description = agentFile.description ?? 'Acceptance agent';
      await writeJson(agentPath, agentFile);
      const withModel = await runCli(mainProject.project, ['push', `agents/${mainProject.agentSlug}`]);
      assertOk(withModel, 'push agent model');
      const modeled = await getAgent(mainProject.agentId, 'selectedModelId,description');
      assert(modeled.selectedModelId === modelId, `model was not stored (${String(modeled.selectedModelId)})`);
    }
    const latest = await readJson<Record<string, unknown>>(agentPath);
    delete latest.description;
    delete latest.model;
    await writeJson(agentPath, latest);
    const pushedAgent = await runCli(mainProject.project, ['push', `agents/${mainProject.agentSlug}`]);
    assertOk(pushedAgent, 'push agent without description or model');
    const storedAgent = await getAgent(mainProject.agentId, 'description,selectedModelId');
    assert(
      storedAgent.description == null || storedAgent.description === '',
      `agent description is ${JSON.stringify(storedAgent.description)}`,
    );
    if (modelId) {
      assert(
        storedAgent.selectedModelId == null || storedAgent.selectedModelId === '',
        `agent model is ${JSON.stringify(storedAgent.selectedModelId)}`,
      );
    }
    await assertPullClean(mainProject.project, 'agent description');
    return modelId ? 'description and model cleared' : 'description cleared (no model available)';
  });

  if (superadminToken) await setLock(false);

  const failed = results.filter((item) => !item.ok);
  console.log('\n# Results');
  for (const item of results) {
    const label = item.skipped ? 'SKIP' : item.ok ? 'PASS' : 'FAIL';
    console.log(`${label}  ${item.name}${item.detail ? ` — ${item.detail}` : ''}`);
  }
  if (failed.length) {
    console.log(`\n${failed.length} failed`);
    process.exitCode = 1;
  } else {
    console.log(`\n${results.length} checks passed`);
  }
}

async function assertPullClean(project: string, label: string): Promise<void> {
  const before = await snapshot(join(project, 'lunnoa'));
  const pulled = await runCli(project, ['pull']);
  assertOk(pulled, `pull after clearing ${label}`);
  const after = await snapshot(join(project, 'lunnoa'));
  const changed = changedFiles(before, after);
  assert(changed.length === 0, `pull after clearing ${label} changed ${changed.join(', ')}`);
}

async function setLock(locked: boolean, workspaceId?: string): Promise<void> {
  if (!superadminToken) return;
  const id =
    workspaceId ??
    String(((await api('GET', '/api/code-sync/context')).body as { workspaceId?: string }).workspaceId ?? '');
  if (!id) return;
  await api('PATCH', `/api/admin/workspaces/${id}/audit-preferences`, {
    token: superadminToken,
    body: { lockCodeSyncedResources: locked },
  });
}

function hasKey(value: unknown, key: string): boolean {
  if (Array.isArray(value)) return value.some((item) => hasKey(item, key));
  if (value && typeof value === 'object') {
    if (Object.prototype.hasOwnProperty.call(value, key)) return true;
    return Object.values(value as Record<string, unknown>).some((item) => hasKey(item, key));
  }
  return false;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function startProxy(target: string): Promise<{
  url: string;
  methods: string[];
  close: () => Promise<void>;
}> {
  const destination = new URL(target);
  const methods: string[] = [];
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    methods.push(`${req.method ?? 'GET'} ${req.url ?? '/'}`);
    const headers = { ...req.headers, host: destination.host };
    const proxied = httpRequest(
      {
        protocol: destination.protocol,
        hostname: destination.hostname,
        port: destination.port,
        method: req.method,
        path: req.url,
        headers,
      },
      (upstream) => {
        res.writeHead(upstream.statusCode ?? 502, upstream.headers);
        upstream.pipe(res);
      },
    );
    proxied.on('error', () => {
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
    req.pipe(proxied);
  });
  return new Promise((resolvePromise) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolvePromise({
        url: `http://127.0.0.1:${port}`,
        methods,
        close: () =>
          new Promise((done) => {
            server.close(() => done());
          }),
      });
    });
  });
}

main().catch(async (error) => {
  if (superadminToken) {
    try {
      await setLock(false);
    } catch {
      // The failure above is the one to report.
    }
  }
  console.error(`\nFAIL  setup — ${redact(error instanceof Error ? error.message : String(error))}`);
  process.exitCode = 1;
});
