import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { access } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';

import type {
  AgentDefinition,
  WorkflowDefinition,
} from '../define';
import { DEFINE_KINDS } from '../define';

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Dynamically import a local definition module (.ts / .js / .mjs).
 * For TypeScript, prefer running the CLI under Node with
 * `--experimental-strip-types` (Node ≥ 22) or via `tsx`.
 */
export async function loadDefinitionModule(
  pathArg: string,
): Promise<Record<string, unknown>> {
  const absolute = resolve(process.cwd(), pathArg);
  if (!(await fileExists(absolute))) {
    throw new Error(`Definition file not found: ${absolute}`);
  }
  const mod = await import(pathToFileURL(absolute).href);
  return mod as Record<string, unknown>;
}

export function pickWorkflowDefinition(
  mod: Record<string, unknown>,
): WorkflowDefinition {
  const candidates = [
    mod.default,
    mod.workflow,
    ...Object.values(mod),
  ];
  for (const value of candidates) {
    if (
      value &&
      typeof value === 'object' &&
      (value as WorkflowDefinition).kind === DEFINE_KINDS.workflow
    ) {
      return value as WorkflowDefinition;
    }
  }
  throw new Error(
    'No defineWorkflow() export found. Export the definition as default or `workflow`.',
  );
}

export function pickAgentDefinition(
  mod: Record<string, unknown>,
): AgentDefinition {
  const candidates = [mod.default, mod.agent, ...Object.values(mod)];
  for (const value of candidates) {
    if (
      value &&
      typeof value === 'object' &&
      (value as AgentDefinition).kind === DEFINE_KINDS.agent
    ) {
      return value as AgentDefinition;
    }
  }
  throw new Error(
    'No defineAgent() export found. Export the definition as default or `agent`.',
  );
}

export async function loadOptionalConfig(): Promise<{
  url?: string;
  apiKey?: string;
  projectId?: string;
}> {
  const candidates = [
    'lunnoa.config.ts',
    'lunnoa.config.mjs',
    'lunnoa.config.js',
    'lunnoa.config.json',
  ];
  for (const name of candidates) {
    const absolute = resolve(process.cwd(), name);
    if (!(await fileExists(absolute))) {
      continue;
    }
    if (name.endsWith('.json')) {
      const { readFile } = await import('node:fs/promises');
      const raw = await readFile(absolute, 'utf8');
      return JSON.parse(raw) as {
        url?: string;
        apiKey?: string;
        projectId?: string;
      };
    }
    const mod = (await import(pathToFileURL(absolute).href)) as {
      default?: Record<string, unknown>;
    } & Record<string, unknown>;
    const cfg = (mod.default ?? mod) as {
      url?: string;
      apiKey?: string;
      projectId?: string;
    };
    return {
      url: cfg.url,
      apiKey: cfg.apiKey,
      projectId: cfg.projectId,
    };
  }
  return {};
}
