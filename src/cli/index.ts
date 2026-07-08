/**
 * `npx @lunnoa/client codegen --url <deployment> --api-key <key> [--out <dir>]`
 *
 * Queries a Lunnoa Automate deployment for its entity types (attribute and
 * state schemas), workflows (manual-trigger input configs), and agents, then
 * writes deployment-specific typed accessors to `<out>/lunnoa.generated.ts`.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { LunnoaClient } from '../client';
import {
  generateDeploymentModule,
  type AgentDefinition,
  type DeploymentDefinitions,
  type EntityTypeDefinition,
  type WorkflowDefinition,
} from './generate';

interface CliArgs {
  command: string | undefined;
  url?: string;
  apiKey?: string;
  accessToken?: string;
  out: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { command: argv[0], out: './src/lunnoa' };
  for (let i = 1; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    switch (flag) {
      case '--url':
        args.url = value;
        i += 1;
        break;
      case '--api-key':
        args.apiKey = value;
        i += 1;
        break;
      case '--access-token':
        args.accessToken = value;
        i += 1;
        break;
      case '--out':
        args.out = value;
        i += 1;
        break;
      default:
        throw new Error(`Unknown option: ${flag}`);
    }
  }
  return args;
}

const USAGE = `Usage:
  npx @lunnoa/client codegen --url <deployment-url> --api-key <lna_key> [--out <dir>]

Options:
  --url           Base URL of the Lunnoa Automate deployment (required)
  --api-key       Machine API key (lna_...); create one in Adminspace → API keys
  --access-token  User JWT as an alternative to --api-key
  --out           Output directory for lunnoa.generated.ts (default: ./src/lunnoa)

Environment variables LUNNOA_URL, LUNNOA_API_KEY are used as fallbacks.
`;

async function fetchDefinitions(client: LunnoaClient, baseUrl: string): Promise<DeploymentDefinitions> {
  const entityTypes = (await client.entityTypes.list({
    expansion: ['attributeSchema', 'stateSchema', 'description'],
  })) as unknown as EntityTypeDefinition[];

  const workflowSummaries = await client.workflows.list({
    expansion: ['description', 'isActive'],
  });

  // triggerNode (which carries the manual trigger's customInputConfig) is
  // only reliably expanded on single-workflow reads.
  const workflows: WorkflowDefinition[] = [];
  for (const summary of workflowSummaries) {
    if (!summary.id) {
      continue;
    }
    try {
      const full = await client.workflows.get(summary.id, {
        expansion: ['description', 'isActive', 'triggerNode'],
      });
      workflows.push(full as unknown as WorkflowDefinition);
    } catch {
      workflows.push(summary as unknown as WorkflowDefinition);
    }
  }

  const agents = (await client.agents.list({
    expansion: ['description'],
  })) as unknown as AgentDefinition[];

  return { baseUrl, entityTypes, workflows, agents };
}

async function runCodegen(args: CliArgs): Promise<void> {
  const url = args.url ?? process.env.LUNNOA_URL;
  const apiKey = args.apiKey ?? process.env.LUNNOA_API_KEY;
  const accessToken = args.accessToken;

  if (!url) {
    throw new Error('Missing --url (or LUNNOA_URL).');
  }
  if (!apiKey && !accessToken) {
    throw new Error('Missing --api-key (or LUNNOA_API_KEY) or --access-token.');
  }

  const client = new LunnoaClient({ baseUrl: url, apiKey, accessToken });

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

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (!args.command || args.command === '--help' || args.command === 'help') {
    console.log(USAGE);
    return;
  }
  if (args.command !== 'codegen') {
    console.error(`Unknown command: ${args.command}\n`);
    console.log(USAGE);
    process.exitCode = 1;
    return;
  }

  await runCodegen(args);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
