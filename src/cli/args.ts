/**
 * Argv parser for `npx @lunnoa/client`.
 * Kept separate from `index.ts` so command parsing is unit-testable.
 */

export interface CliArgs {
  command: string | undefined;
  subcommand?: string;
  /** Deploy definition path, get id, or search query. */
  path?: string;
  url?: string;
  apiKey?: string;
  accessToken?: string;
  projectId?: string;
  out: string;
  json: boolean;
  /** Restrict catalogue / connections to one workflow app id. */
  app?: string;
  /** Only catalogue entries marked availableForAgent. */
  forAgent: boolean;
  help: boolean;
}

const GROUPS_WITH_SUBCOMMAND = new Set([
  'workflows',
  'agents',
  'entity-types',
  'tools',
  'apps',
  'connections',
  'projects',
]);

const VALUE_FLAGS = new Set([
  '--url',
  '--api-key',
  '--access-token',
  '--project-id',
  '--out',
  '--app',
]);

function requireFlagValue(flag: string, value: string | undefined): string {
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    command: argv[0],
    out: './src/lunnoa',
    json: false,
    forAgent: false,
    help: false,
  };
  let i = 1;

  if (args.command && GROUPS_WITH_SUBCOMMAND.has(args.command)) {
    const next = argv[1];
    if (next && !next.startsWith('--')) {
      args.subcommand = next;
      i = 2;
      if (argv[2] && !argv[2].startsWith('--')) {
        args.path = argv[2];
        i = 3;
      }
    }
  }

  for (; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--help' || flag === '-h') {
      args.help = true;
      continue;
    }
    if (flag === '--json') {
      args.json = true;
      continue;
    }
    if (flag === '--for-agent') {
      args.forAgent = true;
      continue;
    }
    if (flag && VALUE_FLAGS.has(flag)) {
      const value = requireFlagValue(flag, argv[i + 1]);
      switch (flag) {
        case '--url':
          args.url = value;
          break;
        case '--api-key':
          args.apiKey = value;
          break;
        case '--access-token':
          args.accessToken = value;
          break;
        case '--project-id':
          args.projectId = value;
          break;
        case '--out':
          args.out = value;
          break;
        case '--app':
          args.app = value;
          break;
        default:
          break;
      }
      i += 1;
      continue;
    }
    if (flag && !flag.startsWith('--') && !args.path) {
      args.path = flag;
      continue;
    }
    throw new Error(`Unknown option: ${flag}`);
  }

  return args;
}

export const USAGE = `Usage:
  npx @lunnoa/client codegen --url <url> --api-key <lna_key> [--out <dir>]

  Discover (do not invent catalogue action ids):
  npx @lunnoa/client tools list [--app <appId>] [--for-agent] [--json]
  npx @lunnoa/client tools get <actionId> [--app <appId>] [--json]
  npx @lunnoa/client tools search <query> [--app <appId>] [--for-agent] [--json]
  npx @lunnoa/client apps list [--for-agent] [--json]
  npx @lunnoa/client apps get <appId> [--json]
  npx @lunnoa/client connections list [--app <appId>] [--json]
  npx @lunnoa/client connections get <connectionId> [--json]
  npx @lunnoa/client agents list [--json]
  npx @lunnoa/client workflows list [--json]
  npx @lunnoa/client entity-types list [--json]
  npx @lunnoa/client projects list [--json]
  npx @lunnoa/client features [--json]

  Deploy (upsert by slug):
  npx @lunnoa/client workflows deploy <path> --url <url> --api-key <key> --project-id <uuid>
  npx @lunnoa/client agents deploy <path> --url <url> --api-key <key> --project-id <uuid>
  npx @lunnoa/client entity-types deploy <path> --url <url> --api-key <key>

Options:
  --url           Base URL of the Lunnoa Automate deployment
  --api-key       Machine API key (lna_...)
  --access-token  User JWT as an alternative to --api-key
  --project-id    Project UUID (required for workflow/agent deploy)
  --out           Output directory for lunnoa.generated.ts (codegen; default: ./src/lunnoa)
  --app           Restrict tools/connections to one workflow app id
  --for-agent     Only catalogue entries with availableForAgent
  --json          Machine-readable JSON (preferred for coding agents)
  --help          Show this help

Environment: LUNNOA_URL, LUNNOA_API_KEY, LUNNOA_PROJECT_ID
Optional config file: lunnoa.config.ts | .mjs | .js | .json

tools get prints inputConfig and a defineAction() sketch. tools list is compact;
run tools get for the schema. Entity-type deploy is workspace-scoped (no
--project-id). Unknown instance attributes are rejected unless
allowUnknownAttributes is true; use extensions.
`;
