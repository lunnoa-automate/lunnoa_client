import type { LunnoaClient } from '../client';
import type { CliArgs } from './args';
import {
  actionDetail,
  filterActions,
  flattenActions,
  resolveAction,
  summarizeAction,
  type CatalogApp,
} from './catalog';
import { printJson, printTable } from './print';

function requireTarget(args: CliArgs, label: string): string {
  const value = args.path?.trim();
  if (!value) {
    throw new Error(`Missing ${label}.`);
  }
  return value;
}

async function loadCatalog(client: LunnoaClient) {
  return flattenActions((await client.workflowApps.list()) as CatalogApp[]);
}

export async function runToolsList(
  client: LunnoaClient,
  args: CliArgs,
): Promise<void> {
  const actions = filterActions(await loadCatalog(client), {
    appId: args.app,
    forAgent: args.forAgent,
  });
  const rows = actions.map(summarizeAction);
  if (args.json) {
    printJson(rows);
    return;
  }
  printTable(rows, [
    { key: 'appId', header: 'APP' },
    { key: 'actionId', header: 'ACTION' },
    { key: 'name', header: 'NAME' },
    { key: 'availableForAgent', header: 'FOR_AGENT' },
    { key: 'needsConnection', header: 'NEEDS_CONN' },
  ]);
}

export async function runToolsGet(
  client: LunnoaClient,
  args: CliArgs,
): Promise<void> {
  const ref = requireTarget(args, 'action id (example: tools get http_action_send-request)');
  const action = resolveAction(await loadCatalog(client), ref, args.app);
  const detail = actionDetail(action);
  if (args.json) {
    printJson(detail);
    return;
  }
  console.log(`appId:             ${detail.appId}`);
  console.log(`actionId:          ${detail.actionId}`);
  console.log(`name:              ${detail.name}`);
  if (detail.description) {
    console.log(`description:       ${detail.description}`);
  }
  console.log(`availableForAgent: ${detail.availableForAgent ? 'yes' : 'no'}`);
  console.log(`needsConnection:   ${detail.needsConnection ? 'yes' : 'no'}`);
  console.log('');
  console.log('inputFields:');
  if (detail.inputFields.length === 0) {
    console.log('  (none advertised)');
  } else {
    for (const field of detail.inputFields) {
      const bits = [
        field.label && field.label !== field.id ? field.label : undefined,
        field.type,
        field.required ? 'required' : undefined,
      ].filter(Boolean);
      console.log(`  ${field.id}${bits.length ? `  (${bits.join(', ')})` : ''}`);
    }
  }
  console.log('');
  console.log('defineAction:');
  console.log(detail.defineAction);
}

export async function runToolsSearch(
  client: LunnoaClient,
  args: CliArgs,
): Promise<void> {
  const query = requireTarget(args, 'search query (example: tools search email)');
  const actions = filterActions(await loadCatalog(client), {
    appId: args.app,
    forAgent: args.forAgent,
    query,
  });
  const rows = actions.map(summarizeAction);
  if (args.json) {
    printJson(rows);
    return;
  }
  printTable(rows, [
    { key: 'appId', header: 'APP' },
    { key: 'actionId', header: 'ACTION' },
    { key: 'name', header: 'NAME' },
    { key: 'availableForAgent', header: 'FOR_AGENT' },
    { key: 'needsConnection', header: 'NEEDS_CONN' },
  ]);
}

export async function runAppsList(
  client: LunnoaClient,
  args: CliArgs,
): Promise<void> {
  const apps = (await client.workflowApps.list()) as CatalogApp[];
  const rows = apps
    .filter((app) => (args.forAgent ? Boolean(app.availableForAgent) : true))
    .filter((app) => (args.app ? app.id === args.app : true))
    .map((app) => ({
      id: app.id ?? '',
      name: app.name ?? app.id ?? '',
      availableForAgent: Boolean(app.availableForAgent),
      needsConnection: Boolean(app.needsConnection),
      actions: Array.isArray(app.actions) ? app.actions.length : 0,
    }));
  if (args.json) {
    printJson(rows);
    return;
  }
  printTable(rows, [
    { key: 'id', header: 'APP' },
    { key: 'name', header: 'NAME' },
    { key: 'availableForAgent', header: 'FOR_AGENT' },
    { key: 'needsConnection', header: 'NEEDS_CONN' },
    { key: 'actions', header: 'ACTIONS' },
  ]);
}

export async function runAppsGet(
  client: LunnoaClient,
  args: CliArgs,
): Promise<void> {
  const appId = requireTarget(args, 'app id (example: apps get http)');
  const apps = (await client.workflowApps.list()) as CatalogApp[];
  const app = apps.find((item) => item.id === appId);
  if (!app) {
    throw new Error(`Unknown app "${appId}". Try: apps list`);
  }
  const actions = flattenActions([app]).map(summarizeAction);
  const payload = {
    id: app.id,
    name: app.name,
    description: app.description ?? '',
    availableForAgent: Boolean(app.availableForAgent),
    needsConnection: Boolean(app.needsConnection),
    isPublished: Boolean(app.isPublished),
    actions,
    connectionTypes: Array.isArray(app.connections) ? app.connections : [],
  };
  if (args.json) {
    printJson(payload);
    return;
  }
  console.log(`id:                ${payload.id}`);
  console.log(`name:              ${payload.name}`);
  if (payload.description) {
    console.log(`description:       ${payload.description}`);
  }
  console.log(`availableForAgent: ${payload.availableForAgent ? 'yes' : 'no'}`);
  console.log(`needsConnection:   ${payload.needsConnection ? 'yes' : 'no'}`);
  console.log('');
  printTable(actions, [
    { key: 'actionId', header: 'ACTION' },
    { key: 'name', header: 'NAME' },
    { key: 'availableForAgent', header: 'FOR_AGENT' },
    { key: 'needsConnection', header: 'NEEDS_CONN' },
  ]);
}

export async function runConnectionsList(
  client: LunnoaClient,
  args: CliArgs,
): Promise<void> {
  const connections = await client.connections.list({
    expansion: ['workflowAppId', 'connectionId', 'createdAt'],
  });
  const rows = connections
    .filter((connection) =>
      args.app ? connection.workflowAppId === args.app : true,
    )
    .map((connection) => ({
      id: connection.id,
      name: connection.name,
      workflowAppId: connection.workflowAppId ?? '',
      connectionId: connection.connectionId ?? '',
    }));
  if (args.json) {
    printJson(rows);
    return;
  }
  printTable(rows, [
    { key: 'id', header: 'ID' },
    { key: 'name', header: 'NAME' },
    { key: 'workflowAppId', header: 'APP' },
    { key: 'connectionId', header: 'TYPE' },
  ]);
}

export async function runConnectionsGet(
  client: LunnoaClient,
  args: CliArgs,
): Promise<void> {
  const id = requireTarget(args, 'connection id (example: connections get <uuid>)');
  const connection = await client.connections.get(id, {
    expansion: ['workflowAppId', 'connectionId', 'createdAt', 'updatedAt'],
  });
  const payload = {
    id: connection.id,
    name: connection.name,
    workflowAppId: connection.workflowAppId ?? null,
    connectionId: connection.connectionId ?? null,
    createdAt: connection.createdAt ?? null,
    updatedAt: connection.updatedAt ?? null,
  };
  if (args.json) {
    printJson(payload);
    return;
  }
  console.log(`id:            ${payload.id}`);
  console.log(`name:          ${payload.name}`);
  console.log(`workflowAppId: ${payload.workflowAppId ?? ''}`);
  console.log(`connectionId:  ${payload.connectionId ?? ''}`);
}

export async function runAgentsList(
  client: LunnoaClient,
  args: CliArgs,
): Promise<void> {
  const agents = await client.agents.list({
    expansion: ['description', 'slug', 'managedByCode'],
  });
  const rows = agents.map((agent) => ({
    id: agent.id,
    name: agent.name,
    slug: agent.slug ?? '',
    managedByCode: Boolean(agent.managedByCode),
    description: agent.description ?? '',
  }));
  if (args.json) {
    printJson(rows);
    return;
  }
  printTable(rows, [
    { key: 'id', header: 'ID' },
    { key: 'slug', header: 'SLUG' },
    { key: 'name', header: 'NAME' },
    { key: 'managedByCode', header: 'CODE' },
  ]);
}

export async function runWorkflowsList(
  client: LunnoaClient,
  args: CliArgs,
): Promise<void> {
  const workflows = await client.workflows.list({
    expansion: ['description', 'isActive', 'slug', 'managedByCode'],
  });
  const rows = workflows.map((workflow) => ({
    id: workflow.id,
    name: workflow.name,
    slug: workflow.slug ?? '',
    isActive: Boolean(workflow.isActive),
    managedByCode: Boolean(workflow.managedByCode),
  }));
  if (args.json) {
    printJson(rows);
    return;
  }
  printTable(rows, [
    { key: 'id', header: 'ID' },
    { key: 'slug', header: 'SLUG' },
    { key: 'name', header: 'NAME' },
    { key: 'isActive', header: 'ACTIVE' },
    { key: 'managedByCode', header: 'CODE' },
  ]);
}

export async function runEntityTypesList(
  client: LunnoaClient,
  args: CliArgs,
): Promise<void> {
  const types = await client.entityTypes.list({
    expansion: ['description'],
  });
  const rows = types.map((type) => ({
    id: type.id,
    slug: type.slug,
    name: type.name,
    managedByCode: Boolean(type.managedByCode),
  }));
  if (args.json) {
    printJson(rows);
    return;
  }
  printTable(rows, [
    { key: 'id', header: 'ID' },
    { key: 'slug', header: 'SLUG' },
    { key: 'name', header: 'NAME' },
    { key: 'managedByCode', header: 'CODE' },
  ]);
}

export async function runProjectsList(
  client: LunnoaClient,
  args: CliArgs,
): Promise<void> {
  const projects = await client.projects.list({
    expansion: ['description', 'countAgents', 'countWorkflows'],
  });
  const rows = projects.map((project) => ({
    id: project.id,
    name: project.name,
    description: project.description ?? '',
    agents: project._count?.agents ?? '',
    workflows: project._count?.workflows ?? '',
  }));
  if (args.json) {
    printJson(rows);
    return;
  }
  printTable(rows, [
    { key: 'id', header: 'ID' },
    { key: 'name', header: 'NAME' },
    { key: 'agents', header: 'AGENTS' },
    { key: 'workflows', header: 'WORKFLOWS' },
  ]);
}

export async function runFeatures(
  client: LunnoaClient,
  args: CliArgs,
): Promise<void> {
  const features = await client.discovery.enabledFeatures();
  if (args.json) {
    printJson(features);
    return;
  }
  const rows = Object.entries(features)
    .filter(([, value]) => typeof value === 'boolean')
    .map(([key, value]) => ({
      feature: key,
      enabled: value as boolean,
    }));
  printTable(rows, [
    { key: 'feature', header: 'FEATURE' },
    { key: 'enabled', header: 'ENABLED' },
  ]);
}
