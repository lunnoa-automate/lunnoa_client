/**
 * Stream agent chat over SSE (AI SDK UIMessage chunk format).
 *
 * Run with:
 *   LUNNOA_URL=... LUNNOA_API_KEY=lna_... AGENT_ID=... npx tsx examples/04-agent-chat-stream.ts
 */
import { randomUUID } from 'node:crypto';

import { LunnoaClient } from '@lunnoa/client';

const lunnoa = new LunnoaClient({
  baseUrl: process.env.LUNNOA_URL!,
  apiKey: process.env.LUNNOA_API_KEY!,
});

async function main() {
  const agentId = process.env.AGENT_ID!;

  // A task is a conversation thread. Client-generated UUIDs are supported:
  // the first stream-message call creates the task row.
  const taskId = randomUUID();

  const stream = await lunnoa.agentChat.streamMessage(
    agentId,
    taskId,
    'Summarise the three most recent pending invoices.',
  );

  // Consume AI SDK UIMessage chunks as they arrive.
  for await (const chunk of stream) {
    switch (chunk.type) {
      case 'text-delta':
        process.stdout.write(chunk.delta);
        break;
      case 'tool-input-available':
        console.log(`\n[tool call] ${'toolName' in chunk ? chunk.toolName : ''}`);
        break;
      case 'finish':
        console.log('\n[turn finished]');
        break;
    }
  }

  // After a disconnect you can reattach to an in-flight turn:
  //   const resumed = await lunnoa.agentChat.resumeStream(agentId, taskId);
  //   if (resumed) for await (const chunk of resumed) { ... }
  // And cancel a running turn:
  //   await lunnoa.agentChat.stop(agentId, taskId);

  // The persisted conversation is available on the task:
  const task = await lunnoa.tasks.get(taskId, { expansion: ['messages'] });
  console.log('Task name:', task.name);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
