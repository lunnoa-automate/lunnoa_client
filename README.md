# @lunnoa/client

TypeScript SDK for building applications **on top of** [Lunnoa Automate](https://github.com/lunnoa-automate/lunnoa_automate).

[![npm version](https://img.shields.io/npm/v/@lunnoa/client)](https://www.npmjs.com/package/@lunnoa/client)
[![license](https://img.shields.io/badge/license-Apache--2.0%20with%20Commons%20Clause-blue)](https://www.npmjs.com/package/@lunnoa/client)

## What is this?

`@lunnoa/client` is the official consumption SDK for the Lunnoa Automate **Public API**: a typed client for agents and chat (with SSE streaming), workflows and executions, entities (Objects), knowledge, queues, variables, and connections — plus a codegen command that types the SDK against **your** deployment's entity types, workflows, and agents.

**The boundary with the other Lunnoa SDK:** [`@lunnoa/toolkit`](https://github.com/lunnoa-automate/lunnoa_toolkit) is for building integration apps that run *inside* the platform (`createAction` / `createApp`); **`@lunnoa/client` is for building applications *on top of* the platform** — including `define*` factories, `runs.start`, and CLI deploy of workflows/agents.

The SDK is deliberately **presentation-free** at the core: no components or widgets. Optional **headless** React hooks ship as `@lunnoa/client/react`. You build fully custom UIs in your own design system; the SDK encodes the platform knowledge (protocols, schemas, conventions). Agent skills for Cursor / Claude Code ship in [`skills/`](./skills/) (see [AI-assisted building](#ai-assisted-building)).

## Installation

```bash
npm install @lunnoa/client
```

**Requirements:** Node.js ≥ 20 (or any runtime with `fetch` and web streams).

### Start a new app

```bash
npx @lunnoa/client init my-app --url https://lunnoa.your-company.example
```

Scaffolds the [lunnoa-starter](https://github.com/lunnoa-automate/lunnoa-starter) Next.js template (thin, Docker-deployable, Lunnoa user login) and writes `.env`, prompting for an API key for CLI commands when run interactively. `--template <owner/repo[#ref]|./local-folder>` overrides the source. Then `npm install` and open the folder in Claude Code / Cursor / Codex.

## Quickstart

```typescript
import { createBrowserClient, isLoginRequires2FA } from '@lunnoa/client';

const lunnoa = createBrowserClient({
  baseUrl: 'https://lunnoa.your-company.example',
});

const result = await lunnoa.auth.login({ email, password });
if (isLoginRequires2FA(result)) {
  await lunnoa.auth.verify2faLogin({
    sessionToken: result.sessionToken,
    token: totpCode,
  });
}

const { data: invoices } = await lunnoa.entities.list({
  objectTypeSlug: 'invoice',
  state: 'pending',
  expansion: ['attributes'],
});
```

People using the app sign in as Lunnoa users (invite, SSO, or SCIM). Their permissions apply. The deployment must allow your origin via `CORS_ALLOWED_ORIGINS`.

`lna_...` API keys are for the CLI (discovery, codegen, deploy), not for the app session. A SuperAdmin creates them in **Adminspace → API keys**, with a minimal RBAC role. The SDK throws if an `lna_` key is used while `window` exists. See the Authentication guide under `guides/develop/client/auth` in Lunnoa Docs for SSO redirect constraints and token stores.

### React (optional)

```tsx
import {
  LunnoaAuthProvider,
  useLunnoaAuth,
  useLunnoaClient,
  useExecutionProgress,
  useNeedsInput,
  useAgentChat,
  useApprovalsInbox,
  useEntityList,
} from '@lunnoa/client/react';

<LunnoaAuthProvider baseUrl={baseUrl}>
  <App />
</LunnoaAuthProvider>

const { user, status, login, logout } = useLunnoaAuth();
const lunnoa = useLunnoaClient();
const { progress, status: progressStatus } = useExecutionProgress(executionId);
const { waiting, pendingInput, submitInput } = useNeedsInput(progress);
const { messages, send, stop, taskId } = useAgentChat(agentId);
const { items, decide } = useApprovalsInbox({ pollIntervalMs: 15_000 });
const { data, page, setPage } = useEntityList({ objectTypeSlug: 'invoice' });
```

Peer: `react` ≥ 18 (required for `/react`). `@ai-sdk/react` (behind `useAgentChat`) ships as a dependency. Core `@lunnoa/client` stays headless.

## Resources

Most namespaces map to the Public API surface (`openapi.public.json`):

`auth` · `agents` · `tasks` · `agentChat` (SSE streaming) · `workflows` · `executions` · `actions` · `entities` · `entityTypes` · `knowledge` · `queues` · `queueItems` · `variables` · `connections` · `workflowApps` · `discovery`

`approvals` uses the authenticated **workspace** API (`/api/approvals/...`), not Public API v1. The inbox is filtered to requests where the current user is an eligible approver.

`scorecards` also uses the workspace API (`/api/scorecards/...`): `list`, `get`, and `recordValue(measureId, { value, period?, note? })` to push a measure value from your own system (API key needs `scorecard:record`).

Errors are `LunnoaApiError` with `status`, `body`, and convenience flags (`isUnauthorized`, `isForbidden`, `isRateLimited`). Paginated lists have async iteration (`entities.iterate(...)`, `queueItems.iterate(...)`).

## Worked examples

Runnable versions live in [`examples/`](./examples).

### Query and create entities

```typescript
const invoiceType = await lunnoa.entityTypes.getBySlug('invoice', {
  expansion: ['attributeSchema', 'stateSchema'],
});

const created = await lunnoa.entities.create({
  name: 'INV-2026-0042',
  objectTypeId: invoiceType.id,
  attributes: { amount: 1250.5, currency: 'CHF' }, // keyed by field ID
});

for await (const invoice of lunnoa.entities.iterate({ objectTypeSlug: 'invoice' })) {
  // pages fetched lazily
}
```

### Trigger a workflow and wait for the result

```typescript
const { id } = await lunnoa.workflows.execute(workflowId, { customerEmail: 'x@y.z' });
const execution = await lunnoa.executions.waitUntilFinished(id); // poll with backoff
console.log(execution.status, execution.output);

// or in one call:
const done = await lunnoa.workflows.executeAndWait(workflowId, inputs);
```

### Run a single app action (ad-hoc Execution)

Creates a one-step Execution with `source: SDK` (same inbox as workflow runs). Discover `appId` / `actionId` / `inputConfig` via `workflowApps.list()`. Pass `connectionId` (the Connection instance UUID from Connections) when the action needs a connection and more than one exists for the app.

```typescript
const result = await lunnoa.actions.run({
  appId: 'http',
  actionId: 'http_action_send-request',
  // connectionId: '...', // Connection.id UUID when needed
  input: { method: 'GET', url: 'https://example.com' },
});
console.log(result.status, result.output, result.executionPath);

// Same record via the Executions API:
const again = await lunnoa.executions.get(result.id, {
  expansion: ['status', 'source', 'executionPath'],
});
```

### Resume a NEEDS_INPUT execution from a custom form

Workflows can pause and wait for human input. Render a form for the waiting step and resume:

```typescript
const execution = await lunnoa.executions.get(executionId, {
  expansion: ['status', 'executionPath'],
});
const waiting = execution.executionPath?.find((s) => s.status === 'NEEDS_INPUT');

await lunnoa.executions.submitInput(executionId, waiting!.nodeId, {
  approved: true,
  comment: 'Release the payment.',
});
const finished = await lunnoa.executions.waitUntilFinished(executionId);
```

The `executionPath` expansion is the business-readable step list (labels, per-step status, timings, loop iterations) custom UIs render progress from.

### Approvals inbox (Request Approval nodes)

List pending approvals the authenticated user can decide, then approve or reject. Prefer a user JWT (pattern B) so eligibility matches a real person. Requires `approvals:read` / `approvals:decide`.

```typescript
const { items } = await lunnoa.approvals.inbox(); // pending + partially_approved

for (const person of items[0]?.eligibleApprovers ?? []) {
  console.log(person.email, person.name); // who can still decide
}

await lunnoa.approvals.decide(items[0]!.approvalId, {
  decision: 'approved',
  comment: 'Within policy limits.',
});

// Or by execution + node when you already have those IDs:
await lunnoa.executions.submitApproval(executionId, nodeId, {
  decision: 'rejected',
  comment: 'Amount exceeds limit.',
});
```

Do not use `submitInput` for Request Approval nodes; that path is for generic `NEEDS_INPUT` forms.

### Stream agent chat

The streaming module is hand-written (code generators handle SSE poorly) and speaks the same wire protocol as the bundled UI: AI SDK `UIMessage` chunks, SSE-framed, resumable.

```typescript
const taskId = crypto.randomUUID(); // first message creates the task
const stream = await lunnoa.agentChat.streamMessage(agentId, taskId, 'Hello!');

for await (const chunk of stream) {
  if (chunk.type === 'text-delta') process.stdout.write(chunk.delta);
}

// Reattach after a disconnect (returns null when nothing is running):
const resumed = await lunnoa.agentChat.resumeStream(agentId, taskId);

// Cancel a running turn (optionally persisting the partial reply):
await lunnoa.agentChat.stop(agentId, taskId);
```

`stream.toUIMessageStream()` returns a `ReadableStream<UIMessageChunk>` ready for the AI SDK's `readUIMessageStream` when you want assembled `UIMessage` snapshots for rendering.

## Deployment-specific codegen

Entity types, workflow inputs, and agents are defined per deployment, so the generic SDK can only type them loosely. The codegen command queries your deployment and emits typed accessors — the same developer experience as Prisma client or Supabase type generation:

```bash
npx @lunnoa/client codegen --url https://lunnoa.your-company.example --api-key lna_... --out ./src/lunnoa
```

This writes `lunnoa.generated.ts`:

```typescript
import { createBrowserClient } from '@lunnoa/client';
import { createDeploymentClient } from './lunnoa/lunnoa.generated';

const lunnoa = createDeploymentClient(createBrowserClient({ baseUrl }));

// Entity attributes and states are compile-time checked:
const open = await lunnoa.entities.invoice.list({ state: 'pending' });
await lunnoa.entities.invoice.create({
  name: 'INV-1',
  attributes: { amount: 99.5, status: 'pending' },
});

// Workflow inputs typed from the manual trigger's input schema:
await lunnoa.workflows.processInvoice.executeAndWait({ invoiceId: 'abc' });

// Agents by name:
const stream = await lunnoa.agents.supportAgent.streamMessage(taskId, 'Hi');
```

Re-run codegen whenever entity types, workflows, or agents change on the deployment.

## Define, run, and CLI deploy

Author local definitions with `defineWorkflow` / `defineAgent` / `defineEntityType`, run linear chains with `lunnoa.runs.start`, and upsert with the CLI (prefer CLI over calling upsert from app code). Agent and workflow upsert is by slug inside the workspace on the API key. An entity type slug is unique on the deployment. Deploy grants that type to the API key's workspace when the slug is new, and will not rewrite a type already granted to other workspaces. Instance writes reject unknown attribute keys unless `allowUnknownAttributes` is true — use the reserved `extensions` object for flexible bags:

```bash
npx @lunnoa/client entity-types deploy ./human.ts --url https://lunnoa.example --api-key lna_...
```

Workflows and agents:

```bash
npx @lunnoa/client workflows deploy ./workflows/sync-orders.ts \
  --url https://lunnoa.example --api-key lna_...
npx @lunnoa/client agents deploy ./agents/triage.ts \
  --url https://lunnoa.example --api-key lna_...
```

`defineAction` binds catalogue actions only; toolkit `createAction` is for in-platform apps. `defineWorkflow` takes an optional `defineTrigger`. Omit it for Manually Run with no input fields. `runs.start` ignores the trigger and runs the steps only. Pass data into step settings with `ref.trigger('caseId')` or `ref.step('load', 'rows', 0)` (give the source step a `key`); the server resolves them on deploy and the builder shows them as mapped fields. See Lunnoa Docs under `guides/develop/client/define`, `runs`, and `cli-deploy`.

### CLI discovery

Coding agents (and humans) should list the catalogue for a given key instead of guessing action ids. `--json` is the machine-readable form.

```bash
npx @lunnoa/client tools list --url … --api-key lna_… --for-agent --json
npx @lunnoa/client tools search email --for-agent --json
npx @lunnoa/client tools get http_action_send-request --json
npx @lunnoa/client apps list --json
npx @lunnoa/client apps get http --json
npx @lunnoa/client connections list --app gmail --json
npx @lunnoa/client ai-connections list --json
npx @lunnoa/client agents list --json
npx @lunnoa/client workflows list --json
npx @lunnoa/client entity-types list --json
npx @lunnoa/client features --json
```

`tools list` is compact (`appId`, `actionId`, name, flags). `tools get` prints `inputConfig` and a `defineAction({ id, appId, input })` sketch. `apps get --json` includes each trigger and a `defineTrigger` sketch. Use `triggers[].triggerId`. Do not invent trigger ids. `ai-connections list --json` prints the model ids each AI connection accepts; use `models[].id` as `defineAgent({ model })`. Auth flags and `LUNNOA_URL` / `LUNNOA_API_KEY` / `lunnoa.config` work the same as deploy. The CLI also reads `./.env` (real environment variables win).

## Regenerating the API types

The generic types are generated from the deployment's public OpenAPI spec (`spec/openapi.public.json`, produced by the platform's `export-openapi --public`):

```bash
npm run codegen:spec
```

## AI-assisted building

Two Cursor / Claude Code skills ship in the published package under `skills/`:

| Skill | Path | Role |
|---|---|---|
| **lunnoa-solution-design** | [`skills/lunnoa-solution-design/SKILL.md`](./skills/lunnoa-solution-design/SKILL.md) | Interview the human, map intent to Lunnoa primitives, produce a build brief |
| **lunnoa-client** | [`skills/lunnoa-client/SKILL.md`](./skills/lunnoa-client/SKILL.md) | Implement with auth, discovery, codegen, `define*` / `runs` / CLI deploy, React hooks |

Install them into your app with `npx @lunnoa/client skills install`. It copies the skills of the installed SDK version into `.claude/skills/` and `.cursor/skills/`. Add it as a `postinstall` script and gitignore both folders so the skills stay in step with the SDK. Prefer **solution-design** first when requirements are unclear, then **lunnoa-client**.

In this repo, edit `skills/` only; `pnpm install` copies it into the local `.cursor/skills/` and `.claude/skills/`.

Partner paste block:

```text
Use @lunnoa/client skills: lunnoa-solution-design then lunnoa-client.
LUNNOA_URL=… LUNNOA_API_KEY=lna_… (server only).
Start by interviewing me, then workflowApps.list() / codegen.
```

Docs quickstart: [For agents](https://docs.lunnoa.com/guides/develop/client/for-agents) (or your deployment’s docs site).

## Versioning and stability

This package follows [semantic versioning](https://semver.org/). It targets the Lunnoa Automate **Public API v1**: endpoints marked stable by the platform's `x-public` contract. Public endpoints only change additively; breaking platform changes come with a deprecation window.

## License

Licensed under **Apache-2.0 with Commons Clause**.

You may use, modify, and distribute the software under Apache 2.0 terms, with one additional restriction: you may not sell the software itself (the SDK as a standalone product). Building and operating applications that *use* the SDK is permitted.

## Development

```bash
git clone https://github.com/lunnoa-automate/lunnoa_client.git
cd lunnoa_client
pnpm install
pnpm test
pnpm build
```

Build output (ESM + CJS + type declarations) is written to `dist/`. The published npm tarball includes `dist/` and `skills/`.

## Publishing

Releases are fully automated with [semantic-release](https://github.com/semantic-release/semantic-release), the same setup as `@lunnoa/toolkit`: merge [Conventional Commits](https://www.conventionalcommits.org/) to `master`/`main`, CI runs tests and build, and the Release workflow computes the version, updates `CHANGELOG.md`, tags, creates the GitHub release, and publishes to npm via trusted publishing (OIDC).

| Commit prefix | Version bump |
| --- | --- |
| `fix:` | Patch |
| `feat:` | Minor |
| `feat!:` / `BREAKING CHANGE:` | Major |

### npm trusted publishing (OIDC)

Publishing uses [npm trusted publishers](https://docs.npmjs.com/trusted-publishers/) via GitHub Actions OIDC — no long-lived `NPM_TOKEN` is required after the package exists.

**Chicken-and-egg for the first publish:** npm only lets you attach a Trusted Publisher to a package that already exists. Bootstrap once (token or placeholder publish), then configure OIDC and prefer that for all later releases.

1. Publish the initial version (e.g. via the `Bootstrap lunnoa_client publish` workflow in `lunnoa_automate`, or `NPM_TOKEN` on the Release workflow).
2. On [npmjs.com](https://www.npmjs.com) (org admin for `@lunnoa`), open the package **Access** tab and add a Trusted Publisher:

| Field | Value |
| --- | --- |
| Package | `@lunnoa/client` |
| Organization / user | `lunnoa-automate` |
| Repository | `lunnoa_client` |
| Workflow filename | `release.yml` |
| Environment | *(leave empty)* |

3. After OIDC works, you can remove `NPM_TOKEN` from the Release workflow env.

The release workflow grants `id-token: write` and uses **semantic-release v25** with Node 24.

### Acceptance soak

Against a real deployment (service-account API key with at least `entities:read`, `entities:create`, `agents:use`):

```bash
LUNNOA_URL=https://your-deployment \
LUNNOA_API_KEY=lna_... \
AGENT_ID=<agent-uuid> \
ENTITY_TYPE_SLUG=<optional-slug> \
pnpm exec tsx scripts/acceptance-soak.ts
```
