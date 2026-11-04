import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { parseArgs } from '../src/cli/args';
import { runInit, setEnvValues } from '../src/cli/init';

describe('init', () => {
  it('parses dir, url, api key, and template', () => {
    const args = parseArgs([
      'init', 'my-app', '--url', 'https://l.example', '--api-key', 'lna_x', '--template', '../starter',
    ]);
    expect(args).toMatchObject({
      command: 'init',
      path: 'my-app',
      url: 'https://l.example',
      apiKey: 'lna_x',
      template: '../starter',
    });
  });

  it('replaces existing keys, appends missing ones, and skips empty values', () => {
    const source = '# url\nLUNNOA_URL=https://old.example\nLUNNOA_API_KEY=\nLUNNOA_AUTH_MODE=server';
    expect(
      setEnvValues(source, {
        LUNNOA_URL: 'https://new.example/$1',
        LUNNOA_API_KEY: undefined,
        LUNNOA_PROJECT_ID: 'p1',
      }),
    ).toBe(
      '# url\nLUNNOA_URL=https://new.example/$1\nLUNNOA_API_KEY=\nLUNNOA_AUTH_MODE=server\nLUNNOA_PROJECT_ID=p1\n',
    );
  });

  it('scaffolds from a local template and writes .env', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lunnoa-init-'));
    const template = join(root, 'template');
    await mkdir(join(template, 'node_modules'), { recursive: true });
    await writeFile(join(template, '.env.example'), 'LUNNOA_URL=\nLUNNOA_API_KEY=\n');
    await writeFile(join(template, 'README.md'), 'hi');

    vi.spyOn(console, 'log').mockImplementation(() => {});
    const dest = join(root, 'app');
    await runInit(parseArgs(['init', dest, '--url', 'https://l.example', '--template', template]));

    expect((await readdir(dest)).sort()).toEqual(['.env', '.env.example', 'README.md']);
    expect(await readFile(join(dest, '.env'), 'utf8')).toBe('LUNNOA_URL=https://l.example\nLUNNOA_API_KEY=\n');
    await expect(
      runInit(parseArgs(['init', dest, '--template', template])),
    ).rejects.toThrow(/not empty/);
  });
});
