/**
 * Run a single catalogue action as an ad-hoc Execution (source: SDK).
 *
 * Run with:
 *   LUNNOA_URL=... LUNNOA_API_KEY=lna_... npx tsx examples/06-actions-run.ts
 *
 * Optional:
 *   CONNECTION_ID=... PROJECT_ID=...
 */
import { LunnoaClient } from '@lunnoa/client';

const lunnoa = new LunnoaClient({
  baseUrl: process.env.LUNNOA_URL!,
  apiKey: process.env.LUNNOA_API_KEY!,
});

async function main() {
  // Discover inputConfig via workflowApps.list() — useful for agents/tools.
  const apps = await lunnoa.workflowApps.list();
  const httpApp = apps.find((app) => app.id === 'http');
  console.log(
    'HTTP actions:',
    (httpApp?.actions as Array<{ id?: string; name?: string }> | undefined)?.map(
      (a) => a.id,
    ),
  );

  const result = await lunnoa.actions.run({
    appId: 'http',
    actionId: 'http_action_send-request',
    connectionId: process.env.CONNECTION_ID,
    projectId: process.env.PROJECT_ID,
    name: 'SDK HTTP ping',
    input: {
      method: 'GET',
      url: 'https://example.com',
    },
  });

  console.log('Execution:', result.id);
  console.log('Status:', result.status);
  console.log('Output:', result.output);

  for (const step of result.executionPath ?? []) {
    console.log(`  [${step.status}] ${step.label}`);
  }

  // Same record appears in the Executions list with source: SDK.
  const again = await lunnoa.executions.get(result.id, {
    expansion: ['status', 'source', 'name', 'executionPath'],
  });
  console.log('Re-read source:', again.source, 'name:', again.name);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
