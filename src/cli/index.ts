/**
 * `npx @lunnoa/client codegen ...`
 * `npx @lunnoa/client tools list|get|search ...`
 * `npx @lunnoa/client workflows|agents|entity-types deploy <path>`
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { LunnoaClient } from '../client';
import { DEFINE_KINDS } from '../define';
import { parseArgs, USAGE, type CliArgs } from './args';
import {
  runAgentsList,
  runAppsGet,
  runAppsList,
  runConnectionsGet,
  runConnectionsList,
  runEntityTypesList,
  runFeatures,
  runProjectsList,
  runToolsGet,
  runToolsList,
  runToolsSearch,
  runWorkflowsList,
} from './discover';
import {
  generateDeploymentModule,
  type AgentDefinition as CodegenAgentDefinition,
  type DeploymentDefinitions,
  type EntityTypeDefinition,
  type WorkflowDefinition as CodegenWorkflowDefinition,
} from './generate';
import {
  loadDefinitionModule,
  loadOptionalConfig,
  pickAgentDefinition,
  pickEntityTypeDefinition,
  pickWorkflowDefinition,
} from './load-definition';
import { agentDefinitionToUpsert } from '../resources/agents';
import { entityTypeDefinitionToUpsert } from '../resources/entity-types';
import { workflowDefinitionToUpsert } from '../resources/workflows';

async function bindClient(args: CliArgs): Promise<{
  client: LunnoaClient;
  projectId?: string;
  url: string;
}> {
  const fileConfig = await loadOptionalConfig();
  const url = args.url ?? process.env.LUNNOA_URL ?? fileConfig.url;
  const apiKey =
    args.apiKey ?? process.env.LUNNOA_API_KEY ?? fileConfig.apiKey;
  const accessToken = args.accessToken;
  const projectId =
    args.projectId ??
    process.env.LUNNOA_PROJECT_ID ??
    fileConfig.projectId;

  if (!url) {
    throw new Error('Missing --url (or LUNNOA_URL / lunnoa.config).');
  }
  if (!apiKey && !accessToken) {
    throw new Error(
      'Missing --api-key (or LUNNOA_API_KEY) or --access-token.',
    );
  }

  return {
    client: new LunnoaClient({ baseUrl: url, apiKey, accessToken }),
    projectId,
    url,
  };
}

async function fetchDefinitions(
  client: LunnoaClient,
  baseUrl: string,
): Promise<DeploymentDefinitions> {
  const entityTypes = (await client.entityTypes.list({
    expansion: ['attributeSchema', 'stateSchema', 'description'],
  })) as unknown as EntityTypeDefinition[];

  const workflowSummaries = await client.workflows.list({
    expansion: ['description', 'isActive'],
  });

  const workflows: CodegenWorkflowDefinition[] = [];
  for (const summary of workflowSummaries) {
    if (!summary.id) {
      continue;
    }
    try {
      const full = await client.workflows.get(summary.id, {
        expansion: ['description', 'isActive', 'triggerNode'],
      });
      workflows.push(full as unknown as CodegenWorkflowDefinition);
    } catch {
      workflows.push(summary as unknown as CodegenWorkflowDefinition);
    }
  }

  const agents = (await client.agents.list({
    expansion: ['description'],
  })) as unknown as CodegenAgentDefinition[];

  return { baseUrl, entityTypes, workflows, agents };
}

async function runCodegen(args: CliArgs): Promise<void> {
  const { client, url } = await bindClient(args);

  console.log(`Querying ${url} ...`);
  const definitions = await fetchDefinitions(client, url);
  console.log(
    `Found ${definitions.entityTypes.length} entity type(s), ` +
      `${definitions.workflows.length} workflow(s), ` +
      `${definitions.agents.length} agent(s).`,
  );

  const moduleSource = generateDeploymentModule(definitions);

  const outDir = resolve(process.cwd(), args.out);
  await mkdir(outDir, { recursive: true });
  const outFile = resolve(outDir, 'lunnoa.generated.ts');
  await writeFile(outFile, moduleSource, 'utf8');
  console.log(`Wrote ${outFile}`);
}

async function deployWorkflow(args: CliArgs): Promise<void> {
  if (!args.path) {
    throw new Error('Missing definition path. Example: workflows deploy ./workflow.ts');
  }
  const { client, projectId } = await bindClient(args);
  if (!projectId) {
    throw new Error(
      'Missing --project-id (or LUNNOA_PROJECT_ID / lunnoa.config).',
    );
  }

  const mod = await loadDefinitionModule(args.path);
  const def = pickWorkflowDefinition(mod);
  const payload = workflowDefinitionToUpsert(def);
  console.log(`Deploying workflow slug="${payload.slug}" to project ${projectId} ...`);
  const result = await client.workflows.upsertBySlug(projectId, payload);
  console.log(`Upserted workflow ${result.id} (${payload.slug})`);
}

async function deployAgent(args: CliArgs): Promise<void> {
  if (!args.path) {
    throw new Error('Missing definition path. Example: agents deploy ./agent.ts');
  }
  const { client, projectId } = await bindClient(args);
  if (!projectId) {
    throw new Error(
      'Missing --project-id (or LUNNOA_PROJECT_ID / lunnoa.config).',
    );
  }

  const mod = await loadDefinitionModule(args.path);
  const def = pickAgentDefinition(mod);

  // Deploy any nested defineWorkflow tools first, then link by id.
  const workflowIds: string[] = [];
  for (const tool of def.tools ?? []) {
    const unwrapped =
      'use' in tool && tool.use ? tool.use : tool;
    if (
      unwrapped &&
      typeof unwrapped === 'object' &&
      (unwrapped as { kind?: string }).kind === DEFINE_KINDS.workflow
    ) {
      const wf = unwrapped as import('../define').WorkflowDefinition;
      const upserted = await client.workflows.upsertBySlug(
        projectId,
        workflowDefinitionToUpsert(wf),
      );
      if (upserted.id) {
        workflowIds.push(upserted.id);
        console.log(`Linked workflow tool ${upserted.id} (${wf.slug})`);
      }
    }
  }

  const payload = agentDefinitionToUpsert(def, { workflowIds });
  console.log(`Deploying agent slug="${payload.slug}" to project ${projectId} ...`);
  const result = await client.agents.upsertBySlug(projectId, payload);
  console.log(`Upserted agent ${result.id} (${payload.slug})`);
}

async function deployEntityType(args: CliArgs): Promise<void> {
  if (!args.path) {
    throw new Error(
      'Missing definition path. Example: entity-types deploy ./entity-type.ts',
    );
  }
  const { client } = await bindClient(args);
  const mod = await loadDefinitionModule(args.path);
  const def = pickEntityTypeDefinition(mod);
  const payload = entityTypeDefinitionToUpsert(def);
  console.log(`Deploying entity type slug="${payload.slug}" ...`);
  const result = await client.entityTypes.upsertBySlug(payload);
  console.log(
    `Upserted entity type ${result.id} (${payload.slug})` +
      (typeof result.schemaRevision === 'number'
        ? ` schemaRevision=${result.schemaRevision}`
        : ''),
  );
}

const DISCOVERY_SUBCOMMANDS: Record<string, string[] | undefined> = {
  tools: ['list', 'get', 'search'],
  apps: ['list', 'get'],
  connections: ['list', 'get'],
  features: undefined,
  projects: ['list'],
};

function isDiscoveryCommand(args: CliArgs): boolean {
  const { command, subcommand } = args;
  if (!command) {
    return false;
  }
  if (command === 'features') {
    return true;
  }
  if (command === 'projects' && (subcommand === 'list' || !subcommand)) {
    return true;
  }
  if (
    (command === 'agents' ||
      command === 'workflows' ||
      command === 'entity-types') &&
    subcommand === 'list'
  ) {
    return true;
  }
  const allowed = DISCOVERY_SUBCOMMANDS[command];
  return Array.isArray(allowed) && Boolean(subcommand && allowed.includes(subcommand));
}

function assertKnownDiscoveryShape(args: CliArgs): void {
  const { command, subcommand } = args;
  const allowed = command ? DISCOVERY_SUBCOMMANDS[command] : undefined;
  if (!command || allowed === undefined) {
    return;
  }
  if (!subcommand || !allowed.includes(subcommand)) {
    throw new Error(
      `Unknown command: ${command} ${subcommand ?? ''}\n\n${USAGE}`,
    );
  }
}

async function runDiscovery(args: CliArgs): Promise<boolean> {
  const { command, subcommand } = args;
  if (command === 'tools' || command === 'apps' || command === 'connections') {
    assertKnownDiscoveryShape(args);
  }
  if (!isDiscoveryCommand(args)) {
    return false;
  }

  const { client } = await bindClient(args);

  if (command === 'tools' && subcommand === 'list') {
    await runToolsList(client, args);
    return true;
  }
  if (command === 'tools' && subcommand === 'get') {
    await runToolsGet(client, args);
    return true;
  }
  if (command === 'tools' && subcommand === 'search') {
    await runToolsSearch(client, args);
    return true;
  }
  if (command === 'apps' && subcommand === 'list') {
    await runAppsList(client, args);
    return true;
  }
  if (command === 'apps' && subcommand === 'get') {
    await runAppsGet(client, args);
    return true;
  }
  if (command === 'connections' && subcommand === 'list') {
    await runConnectionsList(client, args);
    return true;
  }
  if (command === 'connections' && subcommand === 'get') {
    await runConnectionsGet(client, args);
    return true;
  }
  if (command === 'agents' && subcommand === 'list') {
    await runAgentsList(client, args);
    return true;
  }
  if (command === 'workflows' && subcommand === 'list') {
    await runWorkflowsList(client, args);
    return true;
  }
  if (command === 'entity-types' && subcommand === 'list') {
    await runEntityTypesList(client, args);
    return true;
  }
  if (command === 'projects' && (subcommand === 'list' || !subcommand)) {
    await runProjectsList(client, args);
    return true;
  }
  if (command === 'features') {
    await runFeatures(client, args);
    return true;
  }

  return false;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (
    !args.command ||
    args.command === '--help' ||
    args.command === 'help' ||
    args.help
  ) {
    console.log(USAGE);
    return;
  }

  if (args.command === 'codegen') {
    await runCodegen(args);
    return;
  }

  if (await runDiscovery(args)) {
    return;
  }

  if (args.command === 'workflows' && args.subcommand === 'deploy') {
    await deployWorkflow(args);
    return;
  }

  if (args.command === 'agents' && args.subcommand === 'deploy') {
    await deployAgent(args);
    return;
  }

  if (args.command === 'entity-types' && args.subcommand === 'deploy') {
    await deployEntityType(args);
    return;
  }

  console.error(`Unknown command: ${args.command} ${args.subcommand ?? ''}\n`);
  console.log(USAGE);
  process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
