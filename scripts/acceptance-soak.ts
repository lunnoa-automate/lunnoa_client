/**
 * V1 headless acceptance soak (BRD_HEADLESS_PLATFORM §9).
 *
 * Uses only a workspace-scoped API key + @lunnoa/client to:
 *   1. list entity types / entities
 *   2. create an entity (when ENTITY_TYPE_SLUG resolves)
 *   3. open an agent task and stream a chat turn
 *
 * Run:
 *   LUNNOA_URL=… LUNNOA_API_KEY=lna_… AGENT_ID=… \
 *     pnpm exec tsx scripts/acceptance-soak.ts
 *
 * Optional: ENTITY_TYPE_SLUG (defaults to first listed type), ENTITY_NAME
 */
import { randomUUID } from 'node:crypto';

import { LunnoaClient } from '../src/index.js';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value?.trim()) {
    throw new Error(`Missing required env ${name}`);
  }
  return value.trim();
}

async function main(): Promise<void> {
  const baseUrl = requireEnv('LUNNOA_URL');
  const apiKey = requireEnv('LUNNOA_API_KEY');
  const agentId = requireEnv('AGENT_ID');
  const entityTypeSlug = process.env.ENTITY_TYPE_SLUG?.trim();
  const entityName =
    process.env.ENTITY_NAME?.trim() ||
    `soak-${new Date().toISOString().replace(/[:.]/g, '-')}`;

  const lunnoa = new LunnoaClient({ baseUrl, apiKey });
  const steps: string[] = [];

  console.log('1) Discovery — list entity types');
  const entityTypes = await lunnoa.entityTypes.list({
    expansion: ['attributeSchema'],
  });
  if (!Array.isArray(entityTypes) || entityTypes.length === 0) {
    throw new Error('entityTypes.list returned no types — cannot continue soak');
  }
  steps.push(`entityTypes.list → ${entityTypes.length} type(s)`);
  console.log(
    '   ',
    entityTypes.map((t) => `${t.name} (${t.slug})`).join(', '),
  );

  const targetType =
    (entityTypeSlug
      ? entityTypes.find((t) => t.slug === entityTypeSlug)
      : undefined) ?? entityTypes[0];
  if (!targetType) {
    throw new Error(
      entityTypeSlug
        ? `No entity type with slug "${entityTypeSlug}"`
        : 'No entity type available',
    );
  }

  console.log(`2) Create entity on type ${targetType.slug}`);
  const created = await lunnoa.entities.create(
    {
      name: entityName,
      objectTypeId: targetType.id,
      attributes: {},
    },
    { expansion: ['attributes', 'objectType'] },
  );
  if (!created?.id) {
    throw new Error('entities.create did not return an id');
  }
  steps.push(`entities.create → ${created.id}`);
  console.log('   created', created.id);

  console.log('3) List entities (read-back)');
  const page = await lunnoa.entities.list({
    objectTypeSlug: targetType.slug,
    pageSize: 10,
    search: entityName,
  });
  const found = page.data.some((e) => e.id === created.id);
  if (!found) {
    throw new Error(
      `Created entity ${created.id} not found in list/search for ${targetType.slug}`,
    );
  }
  steps.push(`entities.list → found ${created.id}`);

  console.log('4) Agent chat stream');
  const taskId = randomUUID();
  const stream = await lunnoa.agentChat.streamMessage(
    agentId,
    taskId,
    'Reply with exactly: soak-ok',
  );

  let text = '';
  let finished = false;
  for await (const chunk of stream) {
    if (chunk.type === 'text-delta' && 'delta' in chunk) {
      text += String(chunk.delta);
      process.stdout.write(String(chunk.delta));
    }
    if (chunk.type === 'finish') {
      finished = true;
    }
  }
  process.stdout.write('\n');
  if (!finished && !text) {
    throw new Error('agentChat.streamMessage produced no text and no finish');
  }
  steps.push(
    `agentChat.streamMessage → task ${taskId} (${text.length} chars)`,
  );

  const task = await lunnoa.tasks.get(taskId);
  if (!task?.id) {
    throw new Error(`tasks.get(${taskId}) failed after stream`);
  }
  steps.push(`tasks.get → ${task.id}`);

  console.log('\nAcceptance soak PASSED');
  for (const step of steps) {
    console.log(' ✓', step);
  }
}

main().catch((error) => {
  console.error('\nAcceptance soak FAILED');
  console.error(error);
  process.exitCode = 1;
});
