# @lunnoa/client

TypeScript SDK for building applications **on top of** [Lunnoa Automate](https://github.com/lunnoa-automate/lunnoa_automate).

[![npm version](https://img.shields.io/npm/v/@lunnoa/client)](https://www.npmjs.com/package/@lunnoa/client)
[![license](https://img.shields.io/badge/license-Apache--2.0%20with%20Commons%20Clause-blue)](https://www.npmjs.com/package/@lunnoa/client)

## What is this?

`@lunnoa/client` is the official consumption SDK for the Lunnoa Automate **Public API**: a typed client for agents and chat (with SSE streaming), workflows and executions, entities (Objects), knowledge, queues, variables, connections, and projects — plus a codegen command that types the SDK against **your** deployment's entity types, workflows, and agents.

**The boundary with the other Lunnoa SDK:** [`@lunnoa/toolkit`](https://github.com/lunnoa-automate/lunnoa_toolkit) is for building integration apps that run *inside* the platform (`createAction` / `createApp`); **`@lunnoa/client` is for building applications *on top of* the platform** — including `define*` factories, `runs.start`, and CLI deploy of workflows/agents.

The SDK is deliberately **presentation-free** at the core: no components or widgets. Optional **headless** React hooks ship as `@lunnoa/client/react`. You build fully custom UIs in your own design system; the SDK encodes the platform knowledge (protocols, schemas, conventions). Agent skills for Cursor / Claude Code ship in [`skills/`](./skills/) (see [AI-assisted building](#ai-assisted-building)).

## Installation

```bash
npm install @lunnoa/client
```

**Requirements:** Node.js ≥ 20 (or any runtime with `fetch` and web streams).

## Quickstart

```typescript
import { LunnoaClient } from '@lunnoa/client';

const lunnoa = new LunnoaClient({
  baseUrl: 'https://lunnoa.your-company.example',
  apiKey: process.env.LUNNOA_API_KEY, // lna_... — server-side only
});

const { data: invoices } = await lunnoa.entities.list({
  objectTypeSlug: 'invoice',
  state: 'pending',
  expansion: ['attributes'],
});
```

A SuperAdmin creates API keys in **Adminspace → API keys**, choosing the workspace and an RBAC role for the key's service account. The role is the key's entire capability model — grant the minimum permission set, not Admin.

## Two auth patterns

| Pattern | Credential | Where |
|---|---|---|
| **A. Backend holds the key** | `apiKey: 'lna_...'` via `createServerClient` | Your server, background jobs, server-rendered pages. The key acts as a workspace-scoped service account. |
| **B. End users are Lunnoa users** | User JWT via `createBrowserClient` + `lunnoa.auth.*` | Browser apps. Login, 2FA, refresh, and SSO discovery are wrapped; per-user permissions apply. |

```typescript
import {
  createBrowserClient,
  createServerClient,
  isLoginRequires2FA,
} from '@lunnoa/client';

// Pattern A — server-side
const server = createServerClient({
  baseUrl,
  apiKey: process.env.LUNNOA_API_KEY!,
});

// Pattern B — browser (tokens in localStorage by default; auto-refresh on 401)
const lunnoa = createBrowserClient({ baseUrl });
const result = await lunnoa.auth.login({ email, password });
if (isLoginRequires2FA(result)) {
  await lunnoa.auth.verify2faLogin({
    sessionToken: result.sessionToken,
    token: totpCode,
  });
}
const me = await lunnoa.auth.me();
```

**API keys never ship to browsers.** The SDK enforces this: constructing a client with an `lna_` key while `window` exists throws immediately. Browser apps either use Pattern B or call your own backend, which holds the key (backend-for-frontend).

For Pattern B the deployment must allow your origin via its `CORS_ALLOWED_ORIGINS` configuration. See the Authentication guide under `guides/develop/client/auth` in Lunnoa Docs for SSO redirect constraints and token stores.

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
const { messages, send, stop, taskId } = useAgentChat(agentId); // needs @ai-sdk/react
const { items, decide } = useApprovalsInbox({ pollIntervalMs: 15_000 });
const { data, page, setPage } = useEntityList({ objectTypeSlug: 'invoice' });
```

Peers: `react` ≥ 18 (required for `/react`); `@ai-sdk/react` only for `useAgentChat`. Core `@lunnoa/client` stays headless.

## Resources

Most namespaces map to the Public API surface (`openapi.public.json`):

`auth` · `agents` · `tasks` · `agentChat` (SSE streaming) · `workflows` · `executions` · `actions` · `entities` · `entityTypes` · `knowledge` · `queues` · `queueItems` · `variables` · `connections` · `projects` · `workflowApps` · `discovery`

`approvals` uses the authenticated **workspace** API (`/api/approvals/...`), not Public API v1. The inbox is filtered to requests where the current user is an eligible approver.

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
import { LunnoaClient } from '@lunnoa/client';
import { createDeploymentClient } from './lunnoa/lunnoa.generated';

const lunnoa = createDeploymentClient(new LunnoaClient({ baseUrl, apiKey }));

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

Author local definitions with `defineWorkflow` / `defineAgent`, run linear chains with `lunnoa.runs.start`, and upsert into a project with the CLI (prefer CLI over calling upsert from app code):

```bash
npx @lunnoa/client workflows deploy ./workflows/sync-orders.ts \
  --url https://lunnoa.example --api-key lna_... --project-id <uuid>
npx @lunnoa/client agents deploy ./agents/triage.ts \
  --url https://lunnoa.example --api-key lna_... --project-id <uuid>
```

`defineAction` binds catalogue actions only; toolkit `createAction` is for in-platform apps. See Lunnoa Docs under `guides/develop/client/define`, `runs`, and `cli-deploy`.

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

After install, copy or enable them from `node_modules/@lunnoa/client/skills/` into your app’s `.cursor/skills/` (or Claude Code skills directory). Prefer **solution-design** first when requirements are unclear, then **lunnoa-client**.

Partner paste block:

```text
Use @lunnoa/client skills: lunnoa-solution-design then lunnoa-client.
LUNNOA_URL=… LUNNOA_API_KEY=lna_… (server only). Project ID=…
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

Build output (ESM + CJS + type declarations) is written to `dist/`. Only `dist/` is included in the published npm tarball.

## Publishing

Releases are fully automated with [semantic-release](https://github.com/semantic-release/semantic-release), the same setup as `@lunnoa/toolkit`: merge [Conventional Commits](https://www.conventionalcommits.org/) to `master`/`main`, CI runs tests and build, and the Release workflow computes the version, updates `CHANGELOG.md`, tags, creates the GitHub release, and publishes to npm via trusted publishing (OIDC).

| Commit prefix | Version bump |
| --- | --- |
| `fix:` | Patch |
| `feat:` | Minor |
| `feat!:` / `BREAKING CHANGE:` | Major |

### npm trusted publishing (OIDC)

Publishing uses [npm trusted publishers](https://docs.npmjs.com/trusted-publishers/) via GitHub Actions OIDC — no `NPM_TOKEN` secret is required.

Before the first release, configure a **Trusted Publisher** on [npmjs.com](https://www.npmjs.com) (org admin login for `@lunnoa`):

| Field | Value |
| --- | --- |
| Package | `@lunnoa/client` |
| Organization / user | `lunnoa-automate` |
| Repository | `lunnoa_client` |
| Workflow filename | `release.yml` |
| Environment | *(leave empty)* |

The release workflow grants `id-token: write` and uses **semantic-release v25** with Node 24.
