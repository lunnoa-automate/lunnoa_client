---
name: lunnoa-client
description: >-
  Builds custom frontends and backends on top of a Lunnoa Automate deployment
  using the @lunnoa/client TypeScript SDK. Covers the two auth patterns
  (server-side lna_ API keys, browser user JWTs — never lna_ keys in a
  browser), discovery of the deployment's agents, workflows, and entity
  types, running the deployment codegen first for typed accessors, querying
  and creating entities, triggering workflows and polling executions,
  resuming NEEDS_INPUT executions from custom forms, streaming agent chat
  over SSE in the AI SDK UIMessage format, and rendering execution progress
  from the executionPath expansion. Use when asked to build a portal,
  internal tool, dashboard, chat UI, form, or any application backed by
  Lunnoa Automate agents, workflows, entities (Objects), queues, or
  knowledge; or when the user mentions @lunnoa/client, lna_ API keys, the
  Lunnoa Public API, stream-message, executionPath, or NEEDS_INPUT.
---

# Building custom UIs on Lunnoa Automate with @lunnoa/client

Lunnoa Automate is a self-hosted agent and workflow automation platform. Its
Public API (machine-authenticated, stability-promised) lets you build fully
custom applications on top: portals, review tools, chat UIs, dashboards. The
official SDK is **`@lunnoa/client`** (npm).

This skill teaches an agent how to build such an application correctly.

**Boundary:** `@lunnoa/toolkit` is a different SDK for building integration
apps that run *inside* the platform. For applications *on top of* the
platform, always use `@lunnoa/client`.

**No prebuilt UI exists on purpose.** The SDK ships no components, hooks, or
widgets. You build the UI in the app's own framework and design system; the
SDK provides typed data access and protocols.

---

## 1. Auth: decide the pattern first

| Pattern | Credential | Use when |
|---|---|---|
| **A. Backend holds the key** | `apiKey: 'lna_...'` (workspace-scoped service account) | The app has its own users/login; Lunnoa never needs to know them. All Lunnoa calls go through the app's backend. |
| **B. End users are Lunnoa users** | `accessToken: <user JWT>` from `/api/auth` or `/api/sso` | Per-user permissions, agent shares, and task history must apply. The browser talks to Lunnoa directly. |

Hard rules:

- **NEVER put an `lna_` key in browser code, env vars bundled into the client,
  or anything shipped to the browser.** The SDK throws if an `lna_` key is
  used while `window` exists. A leaked key exposes the whole workspace.
- For browser apps with their own user base, use the **backend-for-frontend
  pattern**: the browser calls your backend; your backend holds the key and
  calls Lunnoa. Next.js route handlers / server actions count as backend.
- Pattern B needs the deployment to allow the app's origin via
  `CORS_ALLOWED_ORIGINS`.
- Keys are minted by a SuperAdmin in **Adminspace → API keys** (workspace +
  RBAC role + optional expiry; secret shown once). Recommend a minimal custom
  role (e.g. `entities:read`, `entities:create`, `agents:use`), not Admin.

```typescript
// Pattern A (server only)
import { LunnoaClient } from '@lunnoa/client';
const lunnoa = new LunnoaClient({
  baseUrl: process.env.LUNNOA_URL!,
  apiKey: process.env.LUNNOA_API_KEY!,
});

// Pattern B (browser)
const lunnoa = new LunnoaClient({
  baseUrl,
  accessToken: () => localStorage.getItem('accessToken')!, // resolved per request
});
```

Errors are `LunnoaApiError` with `.status`, `.body`, `.isUnauthorized`,
`.isForbidden`, `.isRateLimited`. A 403 means the key's role or the
deployment's licence edition does not cover the endpoint.

---

## 2. Run codegen before writing UI code

Entity types, workflow inputs, and agents are **per-deployment**, so the
generic SDK types them loosely. Always generate deployment-specific types
first — a UI built against generated types cannot construct an invalid form
or payload:

```bash
npx @lunnoa/client codegen --url <deployment-url> --api-key <lna_key> --out ./src/lunnoa
```

This emits `src/lunnoa/lunnoa.generated.ts` with `createDeploymentClient`:

```typescript
import { createDeploymentClient } from './lunnoa/lunnoa.generated';
const lunnoa = createDeploymentClient(new LunnoaClient({ baseUrl, apiKey }));

await lunnoa.entities.invoice.list({ state: 'pending' });      // typed attributes + states
await lunnoa.workflows.processInvoice.execute({ invoiceId }); // typed trigger inputs
await lunnoa.agents.supportAgent.streamMessage(taskId, 'Hi'); // agents by name
```

Re-run codegen when the deployment's definitions change. If codegen is not
possible (no key yet), fall back to the generic namespaces and discover at
runtime (next section).

---

## 3. Discover what the deployment offers

```typescript
// Feature flags — adapt the UI to the deployment's edition/infrastructure
const features = await lunnoa.discovery.enabledFeatures();

// Agents, workflows, entity types
const agents = await lunnoa.agents.list({ expansion: ['description'] });
const workflows = await lunnoa.workflows.list({ expansion: ['description', 'isActive'] });
const entityTypes = await lunnoa.entityTypes.list({
  expansion: ['attributeSchema', 'stateSchema'],
});
```

- `attributeSchema.sections[].fields[]` defines each entity field: `id`
  (attribute key), `label`, `type` (`text`, `number`, `currency`, `date`,
  `dropdown` with `config.options`, `boolean`, ...), `required`. Build forms
  and tables from this.
- `stateSchema.states[]` / `transitions[]` is the entity state machine.
  `entities.getStateTransitions(id)` returns the transitions valid *now* —
  render state buttons from that, not from the full schema.
- A workflow's manual-trigger input fields live on
  `workflows.get(id, { expansion: ['triggerNode'] })` →
  `triggerNode.value.customInputConfig` (each field: `id`, `label`,
  `inputType`, `required`, `selectOptions`).
- `workflowApps.list()` resolves `executionPath` step `appId`/`actionId`
  pairs to human-readable names and icons.

List conventions used across the API: `expansion` (comma-separated extra
fields — responses are minimal by default, always request what you render),
`filterBy` (`key:value` pairs), `includeType`.

---

## 4. Recipe: entity table + create form

```typescript
// Table: one page (default pageSize 20, max 100)
const { data, pagination } = await lunnoa.entities.list({
  objectTypeSlug: 'invoice',
  state: 'pending',
  search: userQuery,
  page: 1,
  pageSize: 25,
  expansion: ['attributes', 'createdAt'],
});

// Everything (lazy pages) — exports, aggregations
for await (const entity of lunnoa.entities.iterate({ objectTypeSlug: 'invoice' })) { ... }

// Create — attributes keyed by field ID from the attributeSchema
await lunnoa.entities.create({
  name: 'INV-2026-0042',
  objectTypeId: invoiceType.id,
  attributes: { amount: 1250.5, status: 'pending' },
});

// State change (validated against the type's state machine)
await lunnoa.entities.changeState(entityId, { newState: 'approved', reason: '...' });
```

With codegen: `lunnoa.entities.invoice.create({ name, attributes })` is
compile-time checked.

---

## 5. Recipe: trigger a workflow and render progress

```typescript
const { id } = await lunnoa.workflows.execute(workflowId, inputs);

// Poll with backoff until terminal (SUCCESS/FAILED/CANCELLED) or NEEDS_INPUT
const execution = await lunnoa.executions.waitUntilFinished(id, {
  expansion: ['executionPath'],
});
```

**Render progress from the `executionPath` expansion — never from raw
`nodes`/`edges`.** It is the public, business-readable contract:

```typescript
const execution = await lunnoa.executions.get(id, {
  expansion: ['status', 'executionPath'],
});
// execution.executionPath: Array<{
//   nodeId, label, appId, actionId?, status, statusMessage?,
//   startTime?, endTime?, iterationOf?, iterationIndex?, iterationCount?
// }>
// status per step: RUNNING | SUCCESS | FAILED | NEEDS_INPUT | SCHEDULED | RETRYING | WAITING
```

Render a step list: label + status chip + duration; nest steps carrying
`iterationOf` under their loop parent; resolve `appId`/`actionId` to icons
via `workflowApps.list()`. For a live view, poll `executions.get` with
`executionPath` every 1–2 s while status is non-terminal (only the single-
execution read honours the `executionPath` expansion).

---

## 6. Recipe: resume a NEEDS_INPUT execution from a custom form

Workflows can pause for human input. The waiting step appears in
`executionPath` with `status: 'NEEDS_INPUT'`:

```typescript
const waiting = execution.executionPath?.find((s) => s.status === 'NEEDS_INPUT');
if (waiting) {
  // Render your form, then submit values keyed by field ID:
  await lunnoa.executions.submitInput(execution.id, waiting.nodeId, {
    approved: true,
    comment: formValues.comment,
  });
  // Acknowledged immediately; resumes asynchronously:
  const finished = await lunnoa.executions.waitUntilFinished(execution.id);
}
```

`waitUntilFinished` stops on `NEEDS_INPUT` by default (so the form can be
shown); pass `stopOnNeedsInput: false` to wait through it.

---

## 7. Recipe: agent chat UI (SSE streaming)

The protocol is the AI SDK UIMessage chunk stream (same as the bundled UI).
A task = one conversation thread; client-generated UUIDs are fine — the
first message creates the task.

```typescript
const taskId = crypto.randomUUID();
const stream = await lunnoa.agentChat.streamMessage(agentId, taskId, userText);

for await (const chunk of stream) {
  // chunk.type: 'start' | 'text-start' | 'text-delta' | 'text-end' |
  //             'tool-input-available' | 'tool-output-available' |
  //             'reasoning-*' | 'finish' | 'error' | ...
  if (chunk.type === 'text-delta') appendToUi(chunk.delta);
}
```

- **React apps:** use the AI SDK's `useChat` from `@ai-sdk/react` with a
  `DefaultChatTransport` pointed at
  `${baseUrl}/api/agents/${agentId}/tasks/${taskId}/stream-message` and an
  `Authorization` header — the endpoint speaks the AI SDK protocol natively.
  Use `@lunnoa/client` for everything non-chat.
- **Non-React:** iterate the `AgentChatStream` directly, or pass
  `stream.toUIMessageStream()` to the AI SDK's `readUIMessageStream` for
  assembled `UIMessage` snapshots.
- **Resume after disconnect:** `agentChat.resumeStream(agentId, taskId)`
  replays the in-flight turn from the beginning; returns `null` (HTTP 204)
  when nothing is running.
- **Stop:** `agentChat.stop(agentId, taskId, { assistantMessage })` cancels
  the turn and can persist the partial reply.
- **History:** `tasks.get(taskId, { expansion: ['messages'] })` returns the
  persisted conversation in UIMessage format.
- **Non-streaming:** `tasks.message(agentId, taskId, text)` waits for the
  full turn.
- Proxies in front of the deployment must not buffer SSE responses.

---

## 8. Human-in-the-loop queues

Queues are the platform's work-item surface for review UIs:

```typescript
const queues = await lunnoa.queues.list();
const { items } = await lunnoa.queueItems.list(queueId, { limit: 50 });
for await (const item of lunnoa.queueItems.iterate(queueId)) { ... }
await lunnoa.queueItems.updateStatus(queueId, itemId, 'COMPLETED');
```

---

## 9. Checklist for a new custom UI

1. Confirm base URL + credential pattern (A or B); wire the key server-side only.
2. Run `npx @lunnoa/client codegen` against the deployment; commit the output.
3. Call `discovery.enabledFeatures()` and hide unsupported areas.
4. Build forms/tables from `attributeSchema` / `customInputConfig` (or the generated types).
5. Render workflow progress from `executionPath`; handle `NEEDS_INPUT` with `submitInput`.
6. Chat: stream via SSE, handle resume (reconnects) and stop, load history from the task.
7. Handle `LunnoaApiError`: 401 → re-auth; 403 → hide the capability; 429 → back off.
