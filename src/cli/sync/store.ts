import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import {
  acceptAgentFile,
  acceptWorkflowGraphFile,
  acceptWorkflowStepsFile,
  type AgentFileDefinition,
  type AgentFileInput,
  type WorkflowFileDefinition,
  type WorkflowGraphFileInput,
  type WorkflowStepsFileInput,
} from '../../define/files';

export class PathEscapeError extends Error {
  constructor(target: string) {
    super(`Refusing to write outside the definitions folder: ${target}`);
    this.name = 'PathEscapeError';
  }
}

export function isOutsideDefinitionsDir(root: string, target: string): boolean {
  const rootAbs = resolve(root);
  const abs = resolve(rootAbs, target);
  const rel = relative(rootAbs, abs);
  return rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel);
}

/** Lexical path check plus symlink escape. Returns a path that stays inside `root`. */
export async function assertInsideDefinitionsDir(
  root: string,
  target: string,
): Promise<string> {
  const rootAbs = resolve(root);
  const abs = resolve(rootAbs, target);
  if (isOutsideDefinitionsDir(rootAbs, abs)) {
    throw new PathEscapeError(target);
  }
  let rootReal = rootAbs;
  try {
    rootReal = await realpath(rootAbs);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const parts = relative(rootAbs, abs).split(sep).filter(Boolean);
  let cursor = rootAbs;
  for (const part of parts) {
    if (part === '..' || part === '.') throw new PathEscapeError(target);
    const next = resolve(cursor, part);
    let stats;
    try {
      stats = await lstat(next);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return abs;
      throw error;
    }
    if (stats.isSymbolicLink()) {
      const real = await realpath(next);
      if (isOutsideDefinitionsDir(rootReal, real)) throw new PathEscapeError(target);
      cursor = real;
      continue;
    }
    cursor = next;
  }
  if (isOutsideDefinitionsDir(rootReal, cursor)) throw new PathEscapeError(target);
  return cursor;
}

export async function writeGuarded(
  root: string,
  target: string,
  contents: string,
): Promise<void> {
  const abs = await assertInsideDefinitionsDir(root, target);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, contents);
}

export function hashDefinition(json: string, instructions?: string): string {
  const hash = createHash('sha256');
  hash.update(json);
  if (instructions !== undefined) {
    hash.update('\0');
    hash.update(instructions);
  }
  return hash.digest('hex');
}

export function deploymentKey(baseUrl: string, workspaceId: string): string {
  return `${baseUrl.replace(/\/+$/, '')}#${workspaceId}`;
}

export interface LockEntry {
  id: string;
  revision: string;
  fileHash: string;
}

export interface LockDeployment {
  agents: Record<string, LockEntry>;
  workflows: Record<string, LockEntry>;
}

export interface LockFile {
  version: 1;
  deployments: Record<string, LockDeployment>;
}

export function emptyLock(): LockFile {
  return { version: 1, deployments: {} };
}

export async function readLock(root: string): Promise<LockFile> {
  try {
    const text = await readFile(resolve(root, 'lunnoa.lock.json'), 'utf8');
    const parsed = JSON.parse(text) as LockFile;
    if (!parsed || parsed.version !== 1 || !parsed.deployments || typeof parsed.deployments !== 'object') {
      throw new Error('lunnoa.lock.json is not a version 1 lock file.');
    }
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyLock();
    throw error;
  }
}

export async function writeLock(root: string, lock: LockFile): Promise<void> {
  await writeGuarded(root, 'lunnoa.lock.json', `${JSON.stringify(lock, null, 2)}\n`);
}

export function lockBucket(lock: LockFile, key: string): LockDeployment {
  const existing = lock.deployments[key] ?? { agents: {}, workflows: {} };
  existing.agents ??= {};
  existing.workflows ??= {};
  lock.deployments[key] = existing;
  return existing;
}

export function schemaRelativePath(
  jsonAbsolutePath: string,
  kind: 'agent' | 'workflow',
  projectRoot: string,
): string {
  const target = resolve(
    projectRoot,
    'node_modules',
    '@lunnoa',
    'client',
    'schemas',
    `${kind}.schema.json`,
  );
  let rel = relative(dirname(jsonAbsolutePath), target).split(sep).join('/');
  if (!rel.startsWith('.')) rel = `./${rel}`;
  return rel;
}

export function serializeDefinition(
  definition: Record<string, unknown>,
  schema: string,
): string {
  const body: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(definition)) {
    if (key === '$schema') continue;
    body[key] = value;
  }
  return `${JSON.stringify({ $schema: schema, ...body }, null, 2)}\n`;
}

export function renderAgentFiles(
  definition: AgentFileDefinition,
  schema: string,
): { json: string; instructions: string; instructionsFile: string } {
  if (typeof definition.instructions !== 'string') {
    throw new Error(
      'Cannot write an agent definition whose instructions are still a file reference.',
    );
  }
  const instructionsFile = `${definition.slug}.instructions.md`;
  const json = serializeDefinition(
    { ...definition, instructions: { file: instructionsFile } },
    schema,
  );
  return { json, instructions: definition.instructions, instructionsFile };
}

export function renderWorkflowFile(
  definition: WorkflowFileDefinition,
  schema: string,
): string {
  return serializeDefinition({ ...definition }, schema);
}

export async function writeAgentDefinition(
  root: string,
  projectRoot: string,
  definition: AgentFileDefinition,
): Promise<string> {
  const jsonRel = join('agents', `${definition.slug}.json`);
  const schema = schemaRelativePath(resolve(root, jsonRel), 'agent', projectRoot);
  const rendered = renderAgentFiles(definition, schema);
  await writeGuarded(root, jsonRel, rendered.json);
  await writeGuarded(root, join('agents', rendered.instructionsFile), rendered.instructions);
  return hashDefinition(rendered.json, rendered.instructions);
}

export async function writeWorkflowDefinition(
  root: string,
  projectRoot: string,
  definition: WorkflowFileDefinition,
): Promise<string> {
  const jsonRel = join('workflows', `${definition.slug}.json`);
  const schema = schemaRelativePath(resolve(root, jsonRel), 'workflow', projectRoot);
  const json = renderWorkflowFile(definition, schema);
  await writeGuarded(root, jsonRel, json);
  return hashDefinition(json);
}

async function readInside(root: string, rel: string): Promise<string | undefined> {
  const lexical = resolve(root, rel);
  if (isOutsideDefinitionsDir(root, lexical)) throw new PathEscapeError(rel);
  try {
    const abs = await assertInsideDefinitionsDir(root, rel);
    return await readFile(abs, 'utf8');
  } catch (error) {
    if (error instanceof PathEscapeError) throw error;
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

export async function hashOnDisk(
  root: string,
  kind: 'agent' | 'workflow',
  slug: string,
): Promise<string | undefined> {
  if (kind === 'workflow') {
    const text = await readInside(root, join('workflows', `${slug}.json`));
    return text === undefined ? undefined : hashDefinition(text);
  }
  const json = await readInside(root, join('agents', `${slug}.json`));
  if (json === undefined) return undefined;
  const parsed = JSON.parse(json) as { instructions?: { file?: string } | string };
  if (
    parsed.instructions &&
    typeof parsed.instructions === 'object' &&
    typeof parsed.instructions.file === 'string'
  ) {
    const instructions = await readInside(root, join('agents', parsed.instructions.file));
    return hashDefinition(json, instructions ?? '');
  }
  return hashDefinition(json);
}

export interface LocalDefinitionFile {
  kind: 'agent' | 'workflow';
  slug: string;
  path: string;
}

export async function listDefinitionFiles(root: string): Promise<LocalDefinitionFile[]> {
  const out: LocalDefinitionFile[] = [];
  for (const kind of ['workflow', 'agent'] as const) {
    const folder = kind === 'agent' ? 'agents' : 'workflows';
    let names: string[];
    try {
      names = await readdir(resolve(root, folder));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    for (const name of names.sort()) {
      if (!name.endsWith('.json')) continue;
      out.push({
        kind,
        slug: name.slice(0, -'.json'.length),
        path: resolve(root, folder, name),
      });
    }
  }
  return out;
}

export async function readLocalText(
  root: string,
  kind: 'agent' | 'workflow',
  slug: string,
): Promise<string | undefined> {
  const folder = kind === 'agent' ? 'agents' : 'workflows';
  const json = await readInside(root, join(folder, `${slug}.json`));
  if (json === undefined) return undefined;
  if (kind === 'workflow') return json;
  const parsed = JSON.parse(json) as { instructions?: { file?: string } | string };
  if (
    parsed.instructions &&
    typeof parsed.instructions === 'object' &&
    typeof parsed.instructions.file === 'string'
  ) {
    const md = await readInside(root, join('agents', parsed.instructions.file));
    return `${json}--- instructions ---\n${md ?? ''}`;
  }
  return json;
}

export interface LoadedDefinition {
  kind: 'agent' | 'workflow';
  definition: AgentFileDefinition | WorkflowFileDefinition;
}

export async function loadDefinitionForPush(
  root: string,
  filePath: string,
): Promise<LoadedDefinition> {
  let text: string;
  try {
    text = await readFile(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`Definition file not found: ${filePath}`);
    }
    throw error;
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`Invalid JSON in ${filePath}`);
  }
  if (parsed.kind === 'agent') {
    const agent = acceptAgentFile(parsed as unknown as AgentFileInput);
    if (typeof agent.instructions === 'object') {
      const mdPath = resolve(dirname(resolve(filePath)), agent.instructions.file);
      const boundary = isOutsideDefinitionsDir(root, resolve(filePath))
        ? dirname(resolve(filePath))
        : root;
      await assertInsideDefinitionsDir(boundary, mdPath);
      const instructions = await readFile(mdPath, 'utf8');
      return { kind: 'agent', definition: { ...agent, instructions } };
    }
    return { kind: 'agent', definition: agent };
  }
  if (
    parsed.kind === 'workflow' ||
    parsed.format === 'steps' ||
    parsed.format === 'graph'
  ) {
    if (parsed.format === 'graph' || (Array.isArray(parsed.nodes) && !parsed.steps)) {
      return {
        kind: 'workflow',
        definition: acceptWorkflowGraphFile(parsed as unknown as WorkflowGraphFileInput),
      };
    }
    return {
      kind: 'workflow',
      definition: acceptWorkflowStepsFile(parsed as unknown as WorkflowStepsFileInput),
    };
  }
  throw new Error(`Definition JSON needs kind "agent" or "workflow": ${filePath}`);
}
