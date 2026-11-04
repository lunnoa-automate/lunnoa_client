/**
 * `npx @lunnoa/client skills install [projectDir]`
 * Copies the skills bundled with this package version into the project, so
 * agent instructions always match the installed SDK.
 */
import { cp } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SKILL_TARGETS = ['.claude/skills', '.cursor/skills'];

/** `dist/cli.js` → package root `skills/`. */
export const BUNDLED_SKILLS_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'skills',
);

export async function installSkills(
  projectDir: string,
  sourceDir = BUNDLED_SKILLS_DIR,
): Promise<string[]> {
  const written: string[] = [];
  for (const target of SKILL_TARGETS) {
    const dest = resolve(projectDir, target);
    await cp(sourceDir, dest, { recursive: true, force: true });
    written.push(dest);
  }
  return written;
}
