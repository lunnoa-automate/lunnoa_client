/**
 * Resume a NEEDS_INPUT execution from a custom form.
 *
 * A workflow can pause and wait for human input (the pause-for-user-input
 * pattern). A custom UI renders a form for the waiting step and submits the
 * values through the SDK to resume the run.
 *
 * Run with:
 *   LUNNOA_URL=... LUNNOA_API_KEY=lna_... EXECUTION_ID=... npx tsx examples/03-needs-input-resume.ts
 */
import { LunnoaClient } from '@lunnoa/client';

const lunnoa = new LunnoaClient({
  baseUrl: process.env.LUNNOA_URL!,
  apiKey: process.env.LUNNOA_API_KEY!,
});

async function main() {
  const executionId = process.env.EXECUTION_ID!;

  // 1. Read the execution with the executionPath expansion — the ordered,
  //    business-readable step list (labels, per-step status, timings).
  const execution = await lunnoa.executions.get(executionId, {
    expansion: ['status', 'executionPath'],
  });

  // 2. Find the step waiting for input.
  const waitingStep = (execution.executionPath ?? []).find(
    (step) => step.status === 'NEEDS_INPUT',
  );
  if (!waitingStep) {
    console.log('No step is waiting for input.');
    return;
  }
  console.log(`Step "${waitingStep.label}" (node ${waitingStep.nodeId}) needs input.`);

  // 3. Submit the values your form collected, keyed by field ID.
  await lunnoa.executions.submitInput(executionId, waitingStep.nodeId, {
    approved: true,
    comment: 'Looks good — release the payment.',
  });
  console.log('Input submitted; execution resumes asynchronously.');

  // 4. Wait for the run to complete.
  const finished = await lunnoa.executions.waitUntilFinished(executionId);
  console.log('Final status:', finished.status);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
