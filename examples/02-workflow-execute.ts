/**
 * Trigger a workflow and wait for the result (poll with backoff).
 *
 * Run with:
 *   LUNNOA_URL=... LUNNOA_API_KEY=lna_... WORKFLOW_ID=... npx tsx examples/02-workflow-execute.ts
 */
import { LunnoaClient } from '@lunnoa/client';

const lunnoa = new LunnoaClient({
  baseUrl: process.env.LUNNOA_URL!,
  apiKey: process.env.LUNNOA_API_KEY!,
});

async function main() {
  const workflowId = process.env.WORKFLOW_ID!;

  // Start the execution with values for the manual trigger's input fields.
  const { id: executionId } = await lunnoa.workflows.execute(workflowId, {
    customerEmail: 'olivia@example.com',
  });
  console.log('Execution started:', executionId);

  // Poll with exponential backoff until it finishes (or pauses for input).
  const execution = await lunnoa.executions.waitUntilFinished(executionId, {
    timeoutMs: 5 * 60 * 1000,
    expansion: ['executionPath'], // include the step list in the final read
  });

  console.log('Status:', execution.status);
  if (execution.status === 'SUCCESS') {
    console.log('Output:', execution.output);
  } else if (execution.status === 'NEEDS_INPUT') {
    console.log('Paused for user input — see examples/03-needs-input-resume.ts');
  } else {
    console.log('Message:', execution.statusMessage);
  }

  // The executionPath expansion is the business-readable progress view.
  for (const step of execution.executionPath ?? []) {
    console.log(`  [${step.status}] ${step.label}`);
  }

  // One-liner alternative:
  // const done = await lunnoa.workflows.executeAndWait(workflowId, { ... });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
