/**
 * `npx @lunnoa/client init <dir> [--url <url>] [--api-key <lna_key>] [--template <owner/repo[#ref]|path>]`
 * Scaffolds the starter app from GitHub (or a local folder) and writes `.env`.
 */
import { spawn } from 'node:child_process';
import { cp, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';

import type { CliArgs } from './args';

export const DEFAULT_TEMPLATE = 'lunnoa-automate/lunnoa-starter';

const SKIP_LOCAL = new Set(['node_modules', '.next', '.git', '.env', '.claude', '.cursor']);

/** Sets `KEY=value` lines, replacing existing keys and appending missing ones. */
export function setEnvValues(
  source: string,
  values: Record<string, string | undefined>,
): string {
  let out = source;
  for (const [key, value] of Object.entries(values)) {
    if (!value) continue;
    const line = `${key}=${value}`;
    const existing = new RegExp(`^${key}=.*$`, 'm');
    out = existing.test(out)
      ? out.replace(existing, () => line)
      : `${out}${out === '' || out.endsWith('\n') ? '' : '\n'}${line}\n`;
  }
  return out;
}

async function isDirectory(path: string): Promise<boolean> {
  return (await stat(path).catch(() => undefined))?.isDirectory() ?? false;
}

async function downloadGithubTemplate(template: string, dest: string): Promise<void> {
  const [repo, ref = 'HEAD'] = template.split('#');
  const url = `https://codeload.github.com/${repo}/tar.gz/${ref}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not download template ${template} (${response.status} from ${url}).`);
  }
  const tarball = Buffer.from(await response.arrayBuffer());
  // Piped via stdin with cwd=dest: no paths for tar to misparse (GNU tar reads `C:` as a host).
  await new Promise<void>((done, fail) => {
    const child = spawn('tar', ['-xzf', '-', '--strip-components=1'], {
      cwd: dest,
      stdio: ['pipe', 'ignore', 'inherit'],
    });
    child.on('error', (error) =>
      fail(new Error(`Could not run tar (${error.message}). Download ${url} manually.`)),
    );
    child.on('close', (code) =>
      code === 0 ? done() : fail(new Error(`tar exited with code ${code}`)),
    );
    child.stdin.end(tarball);
  });
}

export async function runInit(args: CliArgs): Promise<void> {
  if (!args.path) {
    throw new Error('Missing project directory. Example: init my-app --url https://lunnoa.example');
  }
  const dest = resolve(process.cwd(), args.path);
  if ((await readdir(dest).catch(() => [])).length > 0) {
    throw new Error(`${dest} already exists and is not empty.`);
  }
  await mkdir(dest, { recursive: true });

  const template = args.template ?? DEFAULT_TEMPLATE;
  if (await isDirectory(resolve(template))) {
    await cp(resolve(template), dest, {
      recursive: true,
      filter: (src) => !SKIP_LOCAL.has(basename(src)),
    });
  } else {
    console.log(`Downloading ${template} ...`);
    await downloadGithubTemplate(template, dest);
  }

  let { url, apiKey } = args;
  if (process.stdin.isTTY && (!url || !apiKey)) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    url ||= (await rl.question('Lunnoa URL (e.g. https://lunnoa.your-company.example): ')).trim();
    apiKey ||= (
      await rl.question('API key lna_... (server-side only; Enter to skip and sign in as a user instead): ')
    ).trim();
    rl.close();
  }

  const example = await readFile(join(dest, '.env.example'), 'utf8').catch(() => '');
  await writeFile(
    join(dest, '.env'),
    setEnvValues(example, { LUNNOA_URL: url, LUNNOA_API_KEY: apiKey }),
    'utf8',
  );

  console.log(`\nCreated ${dest}\n\nNext steps:`);
  console.log(`  cd ${args.path}`);
  console.log('  npm install');
  if (!apiKey) {
    console.log('  Add LUNNOA_API_KEY to .env, or set LUNNOA_AUTH_MODE=user to sign in with your Lunnoa account');
  }
  console.log('  npm run dev');
  console.log('  Open the folder in Claude Code / Cursor / Codex and describe your idea.');
}
