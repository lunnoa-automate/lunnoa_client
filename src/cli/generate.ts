/**
 * Pure code generation for `npx @lunnoa/client codegen`.
 *
 * Takes the deployment's own definitions (entity types with attribute/state
 * schemas, workflows with manual-trigger input configs, agents) and emits a
 * single readable TypeScript module with typed accessors.
 */

// ---------------------------------------------------------------------------
// Input shapes (the subset of the deployment definitions the generator reads)
// ---------------------------------------------------------------------------

export interface EntityTypeDefinition {
  id: string;
  name: string;
  namePlural?: string;
  slug: string;
  description?: string | null;
  attributeSchema?: {
    sections?: Array<{
      fields?: AttributeFieldDefinition[];
    }>;
  };
  stateSchema?: {
    states?: Array<{ id: string; name?: string }>;
  } | null;
}

export interface AttributeFieldDefinition {
  id: string;
  name?: string;
  label?: string;
  type: string;
  required?: boolean;
  helpText?: string;
  config?: {
    options?: Array<{ value: string; label?: string }>;
    multiple?: boolean;
  };
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  description?: string | null;
  isActive?: boolean;
  triggerNode?: {
    triggerId?: string;
    value?: {
      customInputConfig?: WorkflowInputFieldDefinition[];
    };
  } | null;
}

export interface WorkflowInputFieldDefinition {
  id: string;
  label?: string;
  description?: string;
  inputType?: string;
  required?: { missingMessage?: string; missingStatus?: string } | boolean;
  selectOptions?: Array<{ label?: string; value?: string }>;
  switchOptions?: { checked?: string; unchecked?: string };
  occurenceType?: string;
}

export interface AgentDefinition {
  id: string;
  name: string;
  description?: string | null;
}

export interface DeploymentDefinitions {
  baseUrl: string;
  entityTypes: EntityTypeDefinition[];
  workflows: WorkflowDefinition[];
  agents: AgentDefinition[];
}

// ---------------------------------------------------------------------------
// Naming helpers
// ---------------------------------------------------------------------------

/** `invoice-items` / `Invoice Items` → `invoiceItems` */
export function toCamelCase(input: string): string {
  const parts = input
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .split(/\s+/);
  if (parts.length === 0 || parts[0] === '') {
    return '_';
  }
  const [first, ...rest] = parts;
  const camel =
    first.charAt(0).toLowerCase() +
    first.slice(1) +
    rest.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('');
  return /^[0-9]/.test(camel) ? `_${camel}` : camel;
}

/** `invoice-items` → `InvoiceItems` */
export function toPascalCase(input: string): string {
  const camel = toCamelCase(input);
  return camel.charAt(0).toUpperCase() + camel.slice(1);
}

/** Deduplicates generated identifiers by suffixing `2`, `3`, ... */
function uniqueName(base: string, used: Set<string>): string {
  let name = base;
  let counter = 2;
  while (used.has(name)) {
    name = `${base}${counter}`;
    counter += 1;
  }
  used.add(name);
  return name;
}

function quote(value: string): string {
  return JSON.stringify(value);
}

function docComment(lines: Array<string | undefined>, indent = ''): string {
  const filtered = lines.filter(
    (line): line is string => !!line && line.trim().length > 0,
  );
  if (filtered.length === 0) {
    return '';
  }
  return (
    `${indent}/**\n` +
    filtered.map((line) => `${indent} * ${line.replace(/\*\//g, '*\\/')}`).join('\n') +
    `\n${indent} */\n`
  );
}

// ---------------------------------------------------------------------------
// Type mapping
// ---------------------------------------------------------------------------

/** Maps an entity attribute field to a TypeScript type expression. */
export function attributeFieldToTsType(field: AttributeFieldDefinition): string {
  const options = field.config?.options;
  const optionUnion =
    options && options.length > 0
      ? options.map((o) => quote(o.value)).join(' | ')
      : null;

  switch (field.type) {
    case 'text':
    case 'longText':
    case 'richText':
    case 'url':
    case 'email':
    case 'phone':
      return 'string';
    case 'number':
    case 'currency':
      return 'number';
    case 'date':
    case 'datetime':
      return 'string';
    case 'boolean':
      return 'boolean';
    case 'dropdown':
      return optionUnion ?? 'string';
    case 'multiSelect':
      return optionUnion ? `Array<${optionUnion}>` : 'string[]';
    case 'user':
    case 'team':
    case 'entityReference':
      return field.config?.multiple ? 'string[]' : 'string';
    case 'file':
      return 'unknown';
    default:
      return 'unknown';
  }
}

/** Maps a workflow manual-trigger input field to a TypeScript type expression. */
export function workflowInputFieldToTsType(
  field: WorkflowInputFieldDefinition,
): string {
  const selectUnion =
    field.selectOptions && field.selectOptions.length > 0
      ? field.selectOptions
          .filter((o) => typeof o.value === 'string')
          .map((o) => quote(o.value as string))
          .join(' | ')
      : null;

  let base: string;
  switch (field.inputType) {
    case 'number':
      base = 'number';
      break;
    case 'select':
    case 'dynamic-select':
      base = selectUnion ?? 'string';
      break;
    case 'multi-select':
    case 'dynamic-multi-select':
      base = selectUnion ? `Array<${selectUnion}>` : 'string[]';
      break;
    case 'switch': {
      const on = field.switchOptions?.checked;
      const off = field.switchOptions?.unchecked;
      base = on && off ? `${quote(on)} | ${quote(off)}` : 'string';
      break;
    }
    case 'json':
      base = 'unknown';
      break;
    case 'map':
      base = 'Record<string, string>';
      break;
    case 'text':
    case 'raw-text':
    case 'date':
    case 'date-time':
    case 'code':
    case 'file':
      base = 'string';
      break;
    default:
      base = 'unknown';
  }

  if (field.occurenceType === 'multiple' && !base.endsWith('[]')) {
    base = `Array<${base}>`;
  }
  return base;
}

function isFieldRequired(field: WorkflowInputFieldDefinition): boolean {
  return Boolean(field.required);
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

export function generateDeploymentModule(
  definitions: DeploymentDefinitions,
): string {
  const chunks: string[] = [];

  chunks.push(
    `/* eslint-disable */\n` +
      `/**\n` +
      ` * Deployment-specific typed accessors for ${definitions.baseUrl}\n` +
      ` *\n` +
      ` * Generated by \`npx @lunnoa/client codegen\` — do not edit by hand.\n` +
      ` * Re-run codegen whenever entity types, workflows, or agents change on\n` +
      ` * the deployment.\n` +
      ` */\n` +
      `import type { LunnoaClient, Entity, Execution, ExecuteWorkflowResult, PaginatedEntities, Task, AgentChatStream, WaitUntilFinishedOptions, ListEntitiesOptions, UIMessage } from '@lunnoa/client';\n`,
  );

  chunks.push(GENERATED_RUNTIME_HELPERS);

  const usedTypeNames = new Set<string>();
  const usedPropNames = new Set<string>();

  const entityEntries: Array<{ prop: string; typeName: string; def: EntityTypeDefinition }> = [];
  for (const entityType of definitions.entityTypes) {
    const typeName = uniqueName(toPascalCase(entityType.slug || entityType.name), usedTypeNames);
    const prop = uniqueName(toCamelCase(entityType.slug || entityType.name), usedPropNames);
    entityEntries.push({ prop, typeName, def: entityType });
    chunks.push(generateEntityTypeBlock(entityType, typeName));
  }

  const usedWorkflowProps = new Set<string>();
  const workflowEntries: Array<{ prop: string; typeName: string; def: WorkflowDefinition; fields: WorkflowInputFieldDefinition[] }> = [];
  for (const workflow of definitions.workflows) {
    const fields = workflow.triggerNode?.value?.customInputConfig ?? [];
    const prop = uniqueName(toCamelCase(workflow.name), usedWorkflowProps);
    const typeName = uniqueName(`${toPascalCase(workflow.name)}Inputs`, usedTypeNames);
    workflowEntries.push({ prop, typeName, def: workflow, fields });
    chunks.push(generateWorkflowInputsBlock(workflow, typeName, fields));
  }

  const usedAgentProps = new Set<string>();
  const agentEntries: Array<{ prop: string; def: AgentDefinition }> = [];
  for (const agent of definitions.agents) {
    agentEntries.push({
      prop: uniqueName(toCamelCase(agent.name), usedAgentProps),
      def: agent,
    });
  }

  chunks.push(generateFactory(entityEntries, workflowEntries, agentEntries));

  return chunks.join('\n');
}

function generateEntityTypeBlock(
  entityType: EntityTypeDefinition,
  typeName: string,
): string {
  const fields = (entityType.attributeSchema?.sections ?? []).flatMap(
    (section) => section.fields ?? [],
  );
  const states = entityType.stateSchema?.states ?? [];

  const fieldLines = fields
    .map((field) => {
      const doc = docComment(
        [field.label ?? field.name, field.helpText],
        '  ',
      );
      const optional = field.required ? '' : '?';
      const key = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(field.id)
        ? field.id
        : quote(field.id);
      return `${doc}  ${key}${optional}: ${attributeFieldToTsType(field)};`;
    })
    .join('\n');

  const stateType =
    states.length > 0
      ? states.map((s) => quote(s.id)).join(' | ')
      : 'string';

  const doc = docComment([
    `${entityType.name} (\`${entityType.slug}\`)`,
    entityType.description ?? undefined,
  ]);

  return (
    `${doc}export interface ${typeName}Attributes {\n${fieldLines || '  [fieldId: string]: unknown;'}\n}\n\n` +
    `export type ${typeName}State = ${stateType};\n\n` +
    `export type ${typeName} = Entity & { attributes?: ${typeName}Attributes; state?: ${typeName}State };\n`
  );
}

function generateWorkflowInputsBlock(
  workflow: WorkflowDefinition,
  typeName: string,
  fields: WorkflowInputFieldDefinition[],
): string {
  const doc = docComment([
    `Trigger inputs for workflow "${workflow.name}"`,
    workflow.description ?? undefined,
  ]);

  if (fields.length === 0) {
    return `${doc}export type ${typeName} = Record<string, unknown>;\n`;
  }

  const fieldLines = fields
    .map((field) => {
      const fieldDoc = docComment([field.label, field.description], '  ');
      const optional = isFieldRequired(field) ? '' : '?';
      const key = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(field.id)
        ? field.id
        : quote(field.id);
      return `${fieldDoc}  ${key}${optional}: ${workflowInputFieldToTsType(field)};`;
    })
    .join('\n');

  return `${doc}export interface ${typeName} {\n${fieldLines}\n}\n`;
}

function generateFactory(
  entityEntries: Array<{ prop: string; typeName: string; def: EntityTypeDefinition }>,
  workflowEntries: Array<{ prop: string; typeName: string; def: WorkflowDefinition }>,
  agentEntries: Array<{ prop: string; def: AgentDefinition }>,
): string {
  const entityProps = entityEntries
    .map(({ prop, typeName, def }) => {
      const doc = docComment([`${def.name} entities (\`${def.slug}\`)`], '    ');
      return `${doc}    ${prop}: typedEntityAccessor<${typeName}Attributes, ${typeName}State>(client, ${quote(def.id)}),`;
    })
    .join('\n');

  const workflowProps = workflowEntries
    .map(({ prop, typeName, def }) => {
      const doc = docComment(
        [
          `Workflow "${def.name}"`,
          def.description ?? undefined,
          def.isActive === false ? 'NOTE: currently inactive on the deployment.' : undefined,
        ],
        '    ',
      );
      return `${doc}    ${prop}: typedWorkflowAccessor<${typeName}>(client, ${quote(def.id)}),`;
    })
    .join('\n');

  const agentProps = agentEntries
    .map(({ prop, def }) => {
      const doc = docComment(
        [`Agent "${def.name}"`, def.description ?? undefined],
        '    ',
      );
      return `${doc}    ${prop}: typedAgentAccessor(client, ${quote(def.id)}),`;
    })
    .join('\n');

  return (
    `/**\n` +
    ` * Wraps a \`LunnoaClient\` with accessors typed from this deployment's own\n` +
    ` * entity types, workflows, and agents.\n` +
    ` *\n` +
    ` * \`\`\`ts\n` +
    ` * const lunnoa = createDeploymentClient(new LunnoaClient({ baseUrl, apiKey }));\n` +
    ` * const open = await lunnoa.entities.invoice.list({ state: 'pending' });\n` +
    ` * \`\`\`\n` +
    ` */\n` +
    `export function createDeploymentClient(client: LunnoaClient) {\n` +
    `  return {\n` +
    `    client,\n` +
    `    entities: {\n${entityProps}\n    },\n` +
    `    workflows: {\n${workflowProps}\n    },\n` +
    `    agents: {\n${agentProps}\n    },\n` +
    `  };\n` +
    `}\n`
  );
}

const GENERATED_RUNTIME_HELPERS = `
// ---------------------------------------------------------------------------
// Small runtime helpers the generated accessors are built from.
// ---------------------------------------------------------------------------

function typedEntityAccessor<A, S extends string>(
  client: LunnoaClient,
  objectTypeId: string,
) {
  type Typed = Entity & { attributes?: A; state?: S };
  return {
    objectTypeId,
    /** Lists entities of this type (attributes expanded by default). */
    async list(
      options: Omit<ListEntitiesOptions, 'objectTypeId' | 'objectTypeSlug' | 'state' | 'states'> & {
        state?: S;
        states?: S[];
      } = {},
    ): Promise<Omit<PaginatedEntities, 'data'> & { data: Typed[] }> {
      const result = await client.entities.list({
        expansion: ['attributes'],
        ...options,
        objectTypeId,
      });
      return result as Omit<PaginatedEntities, 'data'> & { data: Typed[] };
    },
    /** Async-iterates every entity of this type. */
    iterate(
      options: Omit<ListEntitiesOptions, 'objectTypeId' | 'objectTypeSlug' | 'page' | 'state' | 'states'> & {
        state?: S;
        states?: S[];
      } = {},
    ): AsyncGenerator<Typed, void, undefined> {
      return client.entities.iterate({
        expansion: ['attributes'],
        ...options,
        objectTypeId,
      }) as AsyncGenerator<Typed, void, undefined>;
    },
    /** Returns a single entity of this type. */
    async get(entityId: string): Promise<Typed> {
      return (await client.entities.get(entityId, {
        expansion: ['attributes'],
      })) as Typed;
    },
    /** Creates an entity of this type with compile-time checked attributes. */
    async create(data: { name: string; attributes?: A; state?: S; ownerId?: string }): Promise<Typed> {
      return (await client.entities.create(
        { ...data, objectTypeId } as never,
        { expansion: ['attributes'] },
      )) as Typed;
    },
    /** Partially updates an entity of this type. */
    async update(
      entityId: string,
      data: { name?: string; attributes?: Partial<A>; ownerId?: string },
    ): Promise<Typed> {
      return (await client.entities.update(entityId, data as never, {
        expansion: ['attributes'],
      })) as Typed;
    },
    /** Soft-deletes an entity of this type. */
    delete(entityId: string): Promise<boolean> {
      return client.entities.delete(entityId);
    },
    /** Moves an entity of this type to a new state. */
    changeState(entityId: string, newState: S, reason?: string) {
      return client.entities.changeState(entityId, { newState, reason } as never);
    },
  };
}

function typedWorkflowAccessor<I>(client: LunnoaClient, workflowId: string) {
  return {
    workflowId,
    /** Starts an execution with compile-time checked trigger inputs. */
    execute(inputs: I): Promise<ExecuteWorkflowResult> {
      return client.workflows.execute(workflowId, inputs as Record<string, unknown>);
    },
    /** Starts an execution and polls until it finishes (or pauses in NEEDS_INPUT). */
    executeAndWait(inputs: I, waitOptions?: WaitUntilFinishedOptions): Promise<Execution> {
      return client.workflows.executeAndWait(
        workflowId,
        inputs as Record<string, unknown>,
        waitOptions,
      );
    },
  };
}

function typedAgentAccessor(client: LunnoaClient, agentId: string) {
  return {
    agentId,
    /** Creates a task (conversation thread) for this agent. */
    createTask(data: { name?: string; id?: string; customIdentifier?: string } = {}): Promise<Task> {
      return client.tasks.create(agentId, data as never);
    },
    /** Sends a message and streams the assistant turn (SSE, AI SDK chunks). */
    streamMessage(
      taskId: string,
      message: string | UIMessage,
      options?: { chatMode?: 'builder' | 'preview'; signal?: AbortSignal },
    ): Promise<AgentChatStream> {
      return client.agentChat.streamMessage(agentId, taskId, message, options);
    },
    /** Sends a message and waits for the full turn (non-streaming). */
    message(taskId: string, message: string | UIMessage) {
      return client.tasks.message(agentId, taskId, message);
    },
  };
}
`;
