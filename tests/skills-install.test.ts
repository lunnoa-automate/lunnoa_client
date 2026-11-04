import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseArgs } from '../src/cli/args';
import { installSkills } from '../src/cli/skills';

const REPO_SKILLS = resolve(__dirname, '..', 'skills');

describe('skills install', () => {
  it('parses an optional project dir', () => {
    const args = parseArgs(['skills', 'install', './my-app']);
    expect(args.subcommand).toBe('install');
    expect(args.path).toBe('./my-app');
  });

  it('copies every bundled skill into .claude and .cursor', async () => {
    const project = await mkdtemp(join(tmpdir(), 'lunnoa-skills-'));
    await installSkills(project, REPO_SKILLS);

    const bundled = (await readdir(REPO_SKILLS)).sort();
    for (const target of ['.claude/skills', '.cursor/skills']) {
      expect((await readdir(join(project, target))).sort()).toEqual(bundled);
      expect(
        await readFile(join(project, target, 'lunnoa-client', 'SKILL.md'), 'utf8'),
      ).toBe(await readFile(join(REPO_SKILLS, 'lunnoa-client', 'SKILL.md'), 'utf8'));
    }
  });
});
