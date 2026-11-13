import { resolve } from 'node:path';

import { LunnoaApiError, publicApiMessage } from '../../core/errors';
import type { LunnoaClient } from '../../client';
import type { AgentFileDefinition, WorkflowFileDefinition } from '../../define/files';
import { findSecretFields, formatConflict } from './diff';
import {
  deploymentKey,
  hashOnDisk,
  listDefinitionFiles,
  loadDefinitionForPush,
  lockBucket,
  readLocalText,
  readLock,
  renderAgentFiles,
  renderWorkflowFile,
  schemaRelativePath,
  writeAgentDefinition,
  writeLock,
  writeWorkflowDefinition,
  type LockEntry,
  type LockFile,
} from './store';

export type ResourceKind = 'agent' | 'workflow';

export type PullSelector =
  | { scope: 'tracked' }
  | { scope: 'all' }
  | { scope: 'one'; kind?: ResourceKind; slug: string };

export type PushSelector =
  | { scope: 'all' }
  | { scope: 'one'; kind?: ResourceKind; slug?: string; file?: string };

export interface SyncRequest {
  client: LunnoaClient;
  definitionsDir: string;
  projectRoot: string;
  force?: boolean;
}

export interface PullReport {
  written: string[];
  skipped: string[];
}

export interface PushReport {
  pushed: string[];
}

export type LocalSyncState = 'unchanged' | 'modified' | 'new' | 'missing';
export type RemoteSyncState = 'unchanged' | 'changed in UI' | 'missing in Lunnoa';

export interface StatusRow {
  kind: ResourceKind;
  slug: string;
  local: LocalSyncState;
  remote: RemoteSyncState;
  conflict: boolean;
}

export class SyncConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SyncConflictError';
  }
}

interface RemoteDefinition {
  kind: ResourceKind;
  id: string;
  slug: string;
  revision: string;
  definition: AgentFileDefinition | WorkflowFileDefinition;
}

function folderOf(kind: ResourceKind): 'agents' | 'workflows' {
  return kind === 'agent' ? 'agents' : 'workflows';
}

function labelOf(kind: ResourceKind, slug: string): string {
  return `${folderOf(kind)}/${slug}.json`;
}

async function fetchDefinition(
  client: LunnoaClient,
  kind: ResourceKind,
  slug: string,
): Promise<RemoteDefinition | null> {
  try {
    const body =
      kind === 'agent'
        ? await client.agents.getDefinition(slug)
        : await client.workflows.getDefinition(slug);
    return {
      kind,
      id: body.id,
      slug: body.definition?.slug || body.slug,
      revision: body.revision,
      definition: body.definition,
    };
  } catch (error) {
    if (error instanceof LunnoaApiError && error.isNotFound) return null;
    throw error;
  }
}

function warnSecrets(kind: ResourceKind, slug: string, definition: unknown): void {
  for (const field of findSecretFields(definition)) {
    console.error(
      `Warning: ${labelOf(kind, slug)} field "${field}" looks like a secret. Definitions are committed; keep secrets in Lunnoa connections.`,
    );
  }
}

function serverText(
  root: string,
  projectRoot: string,
  remote: RemoteDefinition,
): string {
  const rel = labelOf(remote.kind, remote.slug);
  if (remote.kind === 'agent') {
    const schema = schemaRelativePath(resolve(root, rel), 'agent', projectRoot);
    const rendered = renderAgentFiles(remote.definition as AgentFileDefinition, schema);
    return `${rendered.json}--- instructions ---\n${rendered.instructions}`;
  }
  const schema = schemaRelativePath(resolve(root, rel), 'workflow', projectRoot);
  return renderWorkflowFile(remote.definition as WorkflowFileDefinition, schema);
}

async function resolvePullTargets(
  client: LunnoaClient,
  lock: LockFile,
  key: string,
  selector: PullSelector,
): Promise<Array<{ kind: ResourceKind; slug: string }>> {
  if (selector.scope === 'tracked') {
    const dep = lock.deployments[key];
    return [
      ...Object.keys(dep?.workflows ?? {})
        .sort()
        .map((slug) => ({ kind: 'workflow' as const, slug })),
      ...Object.keys(dep?.agents ?? {})
        .sort()
        .map((slug) => ({ kind: 'agent' as const, slug })),
    ];
  }
  if (selector.scope === 'all') {
    const [workflows, agents] = await Promise.all([
      client.workflows.list({ expansion: ['slug'] }),
      client.agents.list({ expansion: ['slug'] }),
    ]);
    return [
      ...workflows
        .filter((workflow) => workflow.slug)
        .map((workflow) => ({ kind: 'workflow' as const, slug: workflow.slug as string })),
      ...agents
        .filter((agent) => agent.slug)
        .map((agent) => ({ kind: 'agent' as const, slug: agent.slug as string })),
    ];
  }
  if (selector.kind) return [{ kind: selector.kind, slug: selector.slug }];
  const [agent, workflow] = await Promise.all([
    fetchDefinition(client, 'agent', selector.slug),
    fetchDefinition(client, 'workflow', selector.slug),
  ]);
  if (agent && workflow) {
    throw new Error(
      `Slug "${selector.slug}" matches an agent and a workflow. Use agents/${selector.slug} or workflows/${selector.slug}.`,
    );
  }
  if (agent) return [{ kind: 'agent', slug: selector.slug }];
  if (workflow) return [{ kind: 'workflow', slug: selector.slug }];
  throw new Error(`No agent or workflow with slug "${selector.slug}".`);
}

export async function pullResources(
  request: SyncRequest,
  selector: PullSelector,
): Promise<PullReport> {
  const context = await request.client.codeSync.context();
  const key = deploymentKey(request.client.http.baseUrl, context.workspaceId);
  const lock = await readLock(request.definitionsDir);
  const targets = await resolvePullTargets(request.client, lock, key, selector);
  const bucket = lockBucket(lock, key);
  const writes: RemoteDefinition[] = [];
  const skipped: string[] = [];
  const conflicts: string[] = [];

  for (const target of targets) {
    const remote = await fetchDefinition(request.client, target.kind, target.slug);
    if (!remote) {
      throw new Error(
        `${target.kind === 'agent' ? 'Agent' : 'Workflow'} "${target.slug}" is missing in Lunnoa.`,
      );
    }
    const entry = bucket[folderOf(target.kind)][remote.slug];
    const hash = await hashOnDisk(request.definitionsDir, target.kind, remote.slug);
    if (entry && entry.revision === remote.revision) {
      skipped.push(labelOf(target.kind, remote.slug));
      continue;
    }
    const localChanged = hash !== undefined && (!entry || hash !== entry.fileHash);
    const serverChanged = !entry || entry.revision !== remote.revision;
    if (localChanged && serverChanged && !request.force) {
      warnSecrets(target.kind, remote.slug, remote.definition);
      const local = (await readLocalText(request.definitionsDir, target.kind, remote.slug)) ?? '';
      conflicts.push(
        formatConflict(
          labelOf(target.kind, remote.slug),
          local,
          serverText(request.definitionsDir, request.projectRoot, remote),
        ),
      );
      continue;
    }
    writes.push(remote);
  }

  if (conflicts.length) {
    throw new SyncConflictError(
      `Local and server both changed. Run pull --force to overwrite.\n\n${conflicts.join('\n\n')}`,
    );
  }

  const written: string[] = [];
  for (const remote of writes) {
    warnSecrets(remote.kind, remote.slug, remote.definition);
    const fileHash =
      remote.kind === 'agent'
        ? await writeAgentDefinition(
            request.definitionsDir,
            request.projectRoot,
            remote.definition as AgentFileDefinition,
          )
        : await writeWorkflowDefinition(
            request.definitionsDir,
            request.projectRoot,
            remote.definition as WorkflowFileDefinition,
          );
    bucket[folderOf(remote.kind)][remote.slug] = {
      id: remote.id,
      revision: remote.revision,
      fileHash,
    };
    written.push(labelOf(remote.kind, remote.slug));
  }
  if (written.length) await writeLock(request.definitionsDir, lock);
  return { written, skipped };
}

async function resolvePushFiles(
  root: string,
  selector: PushSelector,
): Promise<Array<{ kind?: ResourceKind; path: string }>> {
  if (selector.scope === 'all') {
    return (await listDefinitionFiles(root)).map((file) => ({
      kind: file.kind,
      path: file.path,
    }));
  }
  if (selector.file) return [{ kind: selector.kind, path: resolve(selector.file) }];
  if (selector.kind && selector.slug) {
    return [
      {
        kind: selector.kind,
        path: resolve(root, folderOf(selector.kind), `${selector.slug}.json`),
      },
    ];
  }
  if (!selector.slug) throw new Error('Missing definition to push.');
  const found = (await listDefinitionFiles(root)).filter((file) => file.slug === selector.slug);
  if (found.length === 0) throw new Error(`No definition file for "${selector.slug}".`);
  if (found.length > 1) {
    throw new Error(
      `Slug "${selector.slug}" matches an agent and a workflow. Use agents/${selector.slug} or workflows/${selector.slug}.`,
    );
  }
  return [{ kind: found[0]!.kind, path: found[0]!.path }];
}

export async function pushResources(
  request: SyncRequest,
  selector: PushSelector,
): Promise<PushReport> {
  const context = await request.client.codeSync.context();
  const key = deploymentKey(request.client.http.baseUrl, context.workspaceId);
  const lock = await readLock(request.definitionsDir);
  const bucket = lockBucket(lock, key);
  const files = await resolvePushFiles(request.definitionsDir, selector);
  const pushed: string[] = [];

  for (const file of files) {
    const loaded = await loadDefinitionForPush(request.definitionsDir, file.path);
    if (file.kind && loaded.kind !== file.kind) {
      throw new Error(`Expected a ${file.kind} definition, found ${loaded.kind}.`);
    }
    const slug = loaded.definition.slug;
    const entry: LockEntry | undefined = bucket[folderOf(loaded.kind)][slug];
    const options = {
      codeSource: 'synced' as const,
      ...(entry ? { baseRevision: entry.revision } : {}),
      ...(request.force ? { force: true } : {}),
    };
    let id = '';
    let revision = '';
    let definition: AgentFileDefinition | WorkflowFileDefinition;
    try {
      if (loaded.kind === 'workflow') {
        const result = await request.client.workflows.upsertBySlug(
          loaded.definition as WorkflowFileDefinition,
          options,
        );
        id = result.id;
        revision = result.revision;
        definition = result.definition;
      } else {
        const result = await request.client.agents.upsertBySlug(
          loaded.definition as AgentFileDefinition,
          options,
        );
        id = result.id;
        revision = result.revision;
        definition = result.definition;
      }
    } catch (error) {
      if (error instanceof LunnoaApiError && error.status === 409) {
        throw new Error(publicApiMessage(error));
      }
      throw error;
    }
    const fileHash =
      loaded.kind === 'agent'
        ? await writeAgentDefinition(
            request.definitionsDir,
            request.projectRoot,
            definition as AgentFileDefinition,
          )
        : await writeWorkflowDefinition(
            request.definitionsDir,
            request.projectRoot,
            definition as WorkflowFileDefinition,
          );
    bucket[folderOf(loaded.kind)][definition.slug || slug] = { id, revision, fileHash };
    await writeLock(request.definitionsDir, lock);
    pushed.push(labelOf(loaded.kind, definition.slug || slug));
  }
  return { pushed };
}

function localState(
  exists: boolean,
  hash: string | undefined,
  entry: LockEntry | undefined,
): LocalSyncState {
  if (!exists) return 'missing';
  if (!entry) return 'new';
  return hash === entry.fileHash ? 'unchanged' : 'modified';
}

function remoteState(
  remote: RemoteDefinition | null,
  entry: LockEntry | undefined,
): RemoteSyncState {
  if (!remote) return 'missing in Lunnoa';
  if (entry && entry.revision === remote.revision) return 'unchanged';
  return 'changed in UI';
}

function isConflict(local: LocalSyncState, remote: RemoteSyncState): boolean {
  if (local === 'new' && remote === 'missing in Lunnoa') return false;
  if (local === 'missing' && remote === 'missing in Lunnoa') return false;
  return local !== 'unchanged' && remote !== 'unchanged';
}

export async function statusResources(request: SyncRequest): Promise<StatusRow[]> {
  const context = await request.client.codeSync.context();
  const key = deploymentKey(request.client.http.baseUrl, context.workspaceId);
  const lock = await readLock(request.definitionsDir);
  const dep = lock.deployments[key];
  const items = new Map<string, { kind: ResourceKind; slug: string }>();
  for (const slug of Object.keys(dep?.workflows ?? {})) {
    items.set(`workflow:${slug}`, { kind: 'workflow', slug });
  }
  for (const slug of Object.keys(dep?.agents ?? {})) {
    items.set(`agent:${slug}`, { kind: 'agent', slug });
  }
  for (const file of await listDefinitionFiles(request.definitionsDir)) {
    items.set(`${file.kind}:${file.slug}`, { kind: file.kind, slug: file.slug });
  }
  const ordered = [...items.values()].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'workflow' ? -1 : 1;
    return a.slug.localeCompare(b.slug);
  });
  const rows: StatusRow[] = [];
  for (const item of ordered) {
    const remote = await fetchDefinition(request.client, item.kind, item.slug);
    const hash = await hashOnDisk(request.definitionsDir, item.kind, item.slug);
    const entry = dep?.[folderOf(item.kind)]?.[item.slug];
    const local = localState(hash !== undefined, hash, entry);
    const remoteLabel = remoteState(remote, entry);
    rows.push({
      kind: item.kind,
      slug: item.slug,
      local,
      remote: remoteLabel,
      conflict: isConflict(local, remoteLabel),
    });
  }
  return rows;
}
