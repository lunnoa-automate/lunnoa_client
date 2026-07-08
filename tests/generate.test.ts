import { describe, expect, it } from 'vitest';

import {
  attributeFieldToTsType,
  generateDeploymentModule,
  toCamelCase,
  toPascalCase,
  workflowInputFieldToTsType,
  type DeploymentDefinitions,
} from '../src/cli/generate';

describe('naming helpers', () => {
  it('camel-cases slugs and names', () => {
    expect(toCamelCase('invoice-items')).toBe('invoiceItems');
    expect(toCamelCase('Invoice Items')).toBe('invoiceItems');
    expect(toCamelCase('invoice')).toBe('invoice');
    expect(toCamelCase('2nd-review')).toBe('_2ndReview');
  });

  it('pascal-cases slugs and names', () => {
    expect(toPascalCase('invoice-items')).toBe('InvoiceItems');
  });
});

describe('attributeFieldToTsType', () => {
  it('maps primitive field types', () => {
    expect(attributeFieldToTsType({ id: 'a', type: 'text' })).toBe('string');
    expect(attributeFieldToTsType({ id: 'a', type: 'currency' })).toBe('number');
    expect(attributeFieldToTsType({ id: 'a', type: 'boolean' })).toBe('boolean');
    expect(attributeFieldToTsType({ id: 'a', type: 'date' })).toBe('string');
    expect(attributeFieldToTsType({ id: 'a', type: 'file' })).toBe('unknown');
  });

  it('builds unions from dropdown options', () => {
    expect(
      attributeFieldToTsType({
        id: 'status',
        type: 'dropdown',
        config: { options: [{ value: 'open' }, { value: 'closed' }] },
      }),
    ).toBe('"open" | "closed"');
  });

  it('builds array unions for multiSelect', () => {
    expect(
      attributeFieldToTsType({
        id: 'tags',
        type: 'multiSelect',
        config: { options: [{ value: 'red' }, { value: 'blue' }] },
      }),
    ).toBe('Array<"red" | "blue">');
  });

  it('honours multiple for reference fields', () => {
    expect(
      attributeFieldToTsType({
        id: 'owner',
        type: 'user',
        config: { multiple: true },
      }),
    ).toBe('string[]');
  });
});

describe('workflowInputFieldToTsType', () => {
  it('maps input types', () => {
    expect(workflowInputFieldToTsType({ id: 'a', inputType: 'text' })).toBe('string');
    expect(workflowInputFieldToTsType({ id: 'a', inputType: 'number' })).toBe('number');
    expect(workflowInputFieldToTsType({ id: 'a', inputType: 'json' })).toBe('unknown');
    expect(workflowInputFieldToTsType({ id: 'a', inputType: 'map' })).toBe(
      'Record<string, string>',
    );
  });

  it('builds unions from select options', () => {
    expect(
      workflowInputFieldToTsType({
        id: 'priority',
        inputType: 'select',
        selectOptions: [{ value: 'low' }, { value: 'high' }],
      }),
    ).toBe('"low" | "high"');
  });

  it('maps switch options to a value union', () => {
    expect(
      workflowInputFieldToTsType({
        id: 'mode',
        inputType: 'switch',
        switchOptions: { checked: 'yes', unchecked: 'no' },
      }),
    ).toBe('"yes" | "no"');
  });

  it('wraps multiple-occurrence fields in arrays', () => {
    expect(
      workflowInputFieldToTsType({
        id: 'emails',
        inputType: 'text',
        occurenceType: 'multiple',
      }),
    ).toBe('Array<string>');
  });
});

describe('generateDeploymentModule', () => {
  const definitions: DeploymentDefinitions = {
    baseUrl: 'https://lunnoa.example',
    entityTypes: [
      {
        id: 'et-1',
        name: 'Invoice',
        slug: 'invoice',
        description: 'Supplier invoices',
        attributeSchema: {
          sections: [
            {
              fields: [
                { id: 'amount', label: 'Amount', type: 'currency', required: true },
                {
                  id: 'status',
                  label: 'Status',
                  type: 'dropdown',
                  config: { options: [{ value: 'pending' }, { value: 'paid' }] },
                },
                { id: 'due-date', label: 'Due date', type: 'date' },
              ],
            },
          ],
        },
        stateSchema: {
          states: [{ id: 'draft' }, { id: 'approved' }],
        },
      },
    ],
    workflows: [
      {
        id: 'wf-1',
        name: 'Process Invoice',
        isActive: true,
        triggerNode: {
          triggerId: 'flow-control_trigger_manually-run',
          value: {
            customInputConfig: [
              {
                id: 'invoiceId',
                label: 'Invoice ID',
                inputType: 'text',
                required: { missingMessage: 'required', missingStatus: 'error' },
              },
              { id: 'notify', label: 'Notify', inputType: 'switch', switchOptions: { checked: 'true', unchecked: 'false' } },
            ],
          },
        },
      },
    ],
    agents: [{ id: 'ag-1', name: 'Support Agent', description: 'Answers questions' }],
  };

  it('emits typed entity attributes, states, workflows, and agents', () => {
    const source = generateDeploymentModule(definitions);

    expect(source).toContain('export interface InvoiceAttributes');
    expect(source).toContain('amount: number;');
    expect(source).toContain('status?: "pending" | "paid";');
    expect(source).toContain('"due-date"?: string;');
    expect(source).toContain('export type InvoiceState = "draft" | "approved";');

    expect(source).toContain('export interface ProcessInvoiceInputs');
    expect(source).toContain('invoiceId: string;');
    expect(source).toContain('notify?: "true" | "false";');

    expect(source).toContain('createDeploymentClient');
    expect(source).toContain(
      'invoice: typedEntityAccessor<InvoiceAttributes, InvoiceState>(client, "et-1")',
    );
    expect(source).toContain(
      'processInvoice: typedWorkflowAccessor<ProcessInvoiceInputs>(client, "wf-1")',
    );
    expect(source).toContain('supportAgent: typedAgentAccessor(client, "ag-1")');
  });

  it('deduplicates colliding identifiers', () => {
    const source = generateDeploymentModule({
      baseUrl: 'x',
      entityTypes: [],
      workflows: [
        { id: 'wf-1', name: 'Sync' },
        { id: 'wf-2', name: 'Sync' },
      ],
      agents: [],
    });
    expect(source).toContain('sync: typedWorkflowAccessor');
    expect(source).toContain('sync2: typedWorkflowAccessor');
  });
});
