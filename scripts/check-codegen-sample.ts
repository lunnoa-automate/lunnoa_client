/**
 * Sanity check: generates a sample deployment module and verifies it
 * compiles against the SDK. Run via `node --experimental-strip-types
 * scripts/check-codegen-sample.ts` followed by tsc on `.tmp-codegen/`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';

import { generateDeploymentModule } from '../src/cli/generate.ts';

const source = generateDeploymentModule({
  baseUrl: 'https://lunnoa.example',
  entityTypes: [
    {
      id: 'et1',
      name: 'Invoice',
      slug: 'invoice',
      attributeSchema: {
        sections: [
          {
            fields: [
              { id: 'amount', type: 'currency', required: true },
              {
                id: 'status',
                type: 'dropdown',
                config: { options: [{ value: 'pending' }, { value: 'paid' }] },
              },
              { id: 'due-date', type: 'date' },
            ],
          },
        ],
      },
      stateSchema: { states: [{ id: 'draft' }, { id: 'approved' }] },
    },
  ],
  workflows: [
    {
      id: 'wf1',
      name: 'Process Invoice',
      triggerNode: {
        value: {
          customInputConfig: [
            {
              id: 'invoiceId',
              inputType: 'text',
              required: { missingMessage: 'x', missingStatus: 'error' },
            },
          ],
        },
      },
    },
  ],
  agents: [{ id: 'ag1', name: 'Support Agent' }],
});

mkdirSync('.tmp-codegen', { recursive: true });
writeFileSync('.tmp-codegen/lunnoa.generated.ts', source);
console.log('Sample written to .tmp-codegen/lunnoa.generated.ts');
