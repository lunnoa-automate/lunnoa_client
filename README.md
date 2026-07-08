# @lunnoa/client

TypeScript SDK for building applications **on top of** [Lunnoa Automate](https://github.com/lunnoa-automate/lunnoa_automate).

[![npm version](https://img.shields.io/npm/v/@lunnoa/client)](https://www.npmjs.com/package/@lunnoa/client)
[![license](https://img.shields.io/badge/license-Apache--2.0%20with%20Commons%20Clause-blue)](https://www.npmjs.com/package/@lunnoa/client)

## What is this?

`@lunnoa/client` is the official consumption SDK for the Lunnoa Automate **Public API**: a typed client for agents and chat (with SSE streaming), workflows and executions, entities (Objects), knowledge, queues, variables, connections, and projects — plus a codegen command that types the SDK against **your** deployment's entity types, workflows, and agents.

**The boundary with the other Lunnoa SDK:** [`@lunnoa/toolkit`](https://github.com/lunnoa-automate/lunnoa_toolkit) is for building integration apps that run *inside* the platform; **`@lunnoa/client` is for building applications *on top of* the platform** — your own portals, internal tools, and product features backed by Lunnoa agents and workflows.

The SDK is deliberately **presentation-free**: no components, no hooks, no widgets. You build fully custom UIs in your own design system; the SDK encodes the platform knowledge (protocols, schemas, conventions). A frontend-authoring skill for AI coding agents ships with the package (see [`.cursor/skills/lunnoa-client/SKILL.md`](./.cursor/skills/lunnoa-client/SKILL.md)).

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
| **A. Backend holds the key** | `apiKey: 'lna_...'` | Your server, background jobs, server-rendered pages. The key acts as a workspace-scoped service account. |
| **B. End users are Lunnoa users** | `accessToken: <user JWT>` | Browser apps. Users log in via the deployment's `/api/auth` or `/api/sso` flow; per-user permissions, agent shares, and task history apply. |

```typescript
// Pattern A — server-side
const lunnoa = new LunnoaClient({ baseUrl, apiKey: process.env.LUNNOA_API_KEY });

// Pattern B — browser (token resolved per request, so refreshes are picked up)
const lunnoa = new LunnoaClient({
  baseUrl,
  accessToken: () => localStorage.getItem('accessToken')!,
});
```

**API keys never ship to browsers.** The SDK enforces this: constructing a client with an `lna_` key while `window` exists throws immediately. Browser apps either use Pattern B or call your own backend, which holds the key (backend-for-frontend).

For Pattern B the deployment must allow your origin via its `CORS_ALLOWED_ORIGINS` configuration.

## Resources

Every namespace maps to the Public API surface (`openapi.public.json`):

`agents` · `tasks` · `agentChat` (SSE streaming) · `workflows` · `executions` · `entities` · `entityTypes` · `contextBlueprints` · `knowledge` · `queues` · `queueItems` · `variables` · `connections` · `projects` · `workflowApps` · `discovery`

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

## Regenerating the API types

The generic types are generated from the deployment's public OpenAPI spec (`spec/openapi.public.json`, produced by the platform's `export-openapi --public`):

```bash
npm run codegen:spec
```

## AI-assisted UI building

The repo ships a frontend-authoring skill at [`.cursor/skills/lunnoa-client/SKILL.md`](./.cursor/skills/lunnoa-client/SKILL.md) that teaches coding agents (Cursor, Claude) how to build custom UIs against this SDK: auth patterns, discovery, codegen, and the four worked recipes above. Copy it into your app's `.cursor/skills/` folder.

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
