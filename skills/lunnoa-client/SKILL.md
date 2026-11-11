---
name: lunnoa-client
description: >-
  Builds custom frontends and backends on top of a Lunnoa Automate deployment
  using the @lunnoa/client TypeScript SDK. App login is always a Lunnoa user
  (createBrowserClient + lunnoa.auth.login / refresh / SSO). lna_ API keys are
  for the CLI only (discovery, codegen, deploy), never for the app session and
  never in a browser. Covers discovery of the deployment's agents, workflows, and entity
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

**If requirements are unclear, load `lunnoa-solution-design` first** (interview
→ build brief → then return here to implement).

**Boundary:** `@lunnoa/toolkit` is a different SDK for building integration
apps that run *inside* the platform (`createAction` / `createApp`). For
applications *on top of* the platform, always use `@lunnoa/client` —
including `defineAction` / `defineWorkflow` / `defineAgent`, `runs.start`,
and CLI deploy. Do not confuse toolkit `createAction` with client
`defineAction`.

**No prebuilt UI exists on purpose.** The SDK ships no components or widgets.
Optional **headless** React hooks live in `@lunnoa/client/react`. You build the
UI in the app's own framework and design system; the SDK provides typed data
access and protocols.

Human docs (detail): Lunnoa Docs → Develop → TypeScript client SDK.

---

## Mandatory checklist (always)

Run these before inventing resources or shipping UI code:

1. **Auth** — Lunnoa user JWT via `createBrowserClient` + `lunnoa.auth.login`
   (or SSO). **Never** call Lunnoa as the app's users with an `lna_` key, and
   **never** put `lna_` in the browser (SDK throws when `window` exists).
   `lna_` keys are for CLI discovery, codegen, and deploy only.
2. **Codegen** — When building typed UIs, run
   `npx @lunnoa/client codegen` against the deployment first.
3. **Discover before inventing** — prefer the CLI (JSON for agents), then
   the SDK: `npx @lunnoa/client tools list --json --for-agent`,
   `tools get <actionId> --json`, `apps list`, `connections list`,
   `ai-connections list --json`,
   `agents|workflows|entity-types|tables list`, `tables get <slugOrId>`,
   `features`.
   SDK equivalents: `workflowApps.list()`, `agents.list`, `workflows.list`,
   `entityTypes.list`, `tables.list`, `aiConnections.list()`,
   `discovery.enabledFeatures()`.
   Do not invent catalogue action ids or model ids. `connections list` is
   app connections (Gmail, HTTP). `ai-connections list` is the model
   provider connection and the `models[].id` values `defineAgent` accepts.
4. **Run vs deploy** — Ad-hoc: `actions.run` / `runs.start` /
   `workflows.execute`. Durable shared automation: CLI
   `npx @lunnoa/client workflows|agents deploy`. Upsert is by slug
   inside the workspace on the API key. URL and API key are enough.
5. **Toolkit boundary** — Client `defineAction` ≠ toolkit `createAction`.

---

## 1. Auth: Lunnoa users only

Every person who uses the app is a Lunnoa user. If they are not in the
workspace yet, they are provisioned there first (invite, SSO, or SCIM). The
app does not keep its own user directory and does not call Lunnoa with an
`lna_` key on their behalf.

| Caller | Credential |
|---|---|
| **Person using the app** | `createBrowserClient({ baseUrl })` + `lunnoa.auth.login` (password, 2FA, or SSO). Permissions, agent shares, and task history are that user's. |
| **CLI (codegen, discovery, deploy)** | `lna_` API key in `.env` / `--api-key`. Not the app session. |

Hard rules:

- **NEVER put an `lna_` key in browser code, env vars bundled into the client,
  or anything shipped to the browser.** The SDK throws if an `lna_` key is
  used while `window` exists. A leaked key exposes the whole workspace.
- **NEVER build a backend-for-frontend that holds an `lna_` key so the app
  can have its own users.** Next.js route handlers and server actions count
  as the app: they must forward the signed-in user's JWT, not a service key.
- The deployment must allow the app's origin via `CORS_ALLOWED_ORIGINS`.
- CLI keys are minted by a SuperAdmin in **Adminspace → API keys** (workspace +
  RBAC role + optional expiry; secret shown once). Recommend a minimal custom
  role (e.g. `entities:read`, `entities:create`, `agents:use`), not Admin.

```typescript
// App session — login + localStorage token store + auto-refresh on 401
import { createBrowserClient, isLoginRequires2FA } from '@lunnoa/client';
const lunnoa = createBrowserClient({ baseUrl });
const result = await lunnoa.auth.login({ email, password });
if (isLoginRequires2FA(result)) {
  await lunnoa.auth.verify2faLogin({
    sessionToken: result.sessionToken,
    token: totpOrBackupCode,
  });
}
const me = await lunnoa.auth.me();
// SSO: lunnoa.auth.sso.listProviders() / getLoginUrl(id), then loginWithToken
// Logout is local only: await lunnoa.auth.logout()
```

You can still pass a raw `accessToken` getter to `new LunnoaClient(...)` when
you already hold a JWT. Prefer `tokenStore` / `createBrowserClient` when the
SDK should persist and refresh tokens.

SSO browser callbacks redirect to `{CLIENT_URL}/verify-token`, not an arbitrary
custom origin. Password login and `loginWithToken` work from CORS-allowed apps.

**React portals:** import from `@lunnoa/client/react`:

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

const { user, status, login, logout, verify2faLogin } = useLunnoaAuth();
const lunnoa = useLunnoaClient(); // same client for entities / actions / chat
const { progress } = useExecutionProgress(executionId);
const { waiting, pendingInput, submitInput } = useNeedsInput(progress);
const { messages, send, stop, taskId } = useAgentChat(agentId);
const { items, decide } = useApprovalsInbox({ pollIntervalMs: 15_000 });
const { data, setPage } = useEntityList({ objectTypeSlug: 'invoice' });
```

Peer: `react` ≥ 18 for `/react`. `@ai-sdk/react` ships with the SDK (no extra install).
Errors are `LunnoaApiError` with `.status`, `.body`, `.isUnauthorized`,
`.isForbidden`, `.isRateLimited`. A 403 means the user's role or the
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
import { createBrowserClient } from '@lunnoa/client';
import { createDeploymentClient } from './lunnoa/lunnoa.generated';
const lunnoa = createDeploymentClient(createBrowserClient({ baseUrl }));

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

// Tables: small reference / lookup data (list omits rows; get includes them)
const tables = await lunnoa.tables.list();
const costCentres = await lunnoa.tables.getBySlug('cost_centres'); // or tables.get(id)
await lunnoa.tables.upsertBySlug({
  slug: 'cost_centres',
  columns: [{ key: 'code' }, { key: 'owner' }],
  rows: [{ code: 'CC-100', owner: 'Finance' }],
}); // managedByCode defaults to true; omitted columns/rows are kept
```

- Use a **Table** for slowly changing reference data under ~10k rows; anything
  that grows per transaction (invoice, ticket, case) is an **entity**.

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
  `inputType`, `required`, `selectOptions`). Declare them at deploy time
  with `defineTrigger({ id: 'flow-control_trigger_manual', inputs })`.
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
`nodes`/`edges`.** Prefer the SDK helpers for custom timeline UIs:

```typescript
const progress = await lunnoa.executions.getProgress(id);
// progress.steps: label, status, iconUrl, appLogoUrl, durationMs, activeStepIndex

for await (const snap of lunnoa.executions.watchProgress(id)) {
  // live SSE snapshots (execution.progress) until terminal
  renderTimeline(snap);
}
```

Or poll manually:

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
via `workflowApps.list()` (done for you by `getProgress` / `watchProgress`).
`watchProgress` uses `GET /executions/:id/stream` (Bearer fetch; not EventSource).

---

## 5b. Recipe: run a single catalogue action (ad-hoc Execution)

`actions.run` creates a **one-step Execution** with `source: SDK`. It is not a
separate ActionRun product; list/get it via `executions.*` like any other run.

```typescript
// Discover appId / actionId / inputConfig
const apps = await lunnoa.workflowApps.list();
const http = apps.find((a) => a.id === 'http');
// http.actions[].id / .inputConfig

const result = await lunnoa.actions.run({
  appId: 'http',
  actionId: 'http_action_send-request',
  // connectionId: '<Connection.id UUID>', // required if needsConnection + multiple
  input: { method: 'GET', url: 'https://example.com' },
  name: 'Ping example',
});
// result: { id, status, statusMessage?, output?, executionPath? }

const again = await lunnoa.executions.get(result.id, {
  expansion: ['status', 'source', 'name', 'executionPath'],
});
```

**Connection rules (fail-closed):** use the Connection instance UUID
(`Connection.id` from Connections UI / `connections.list()`). If omitted:
sole usable connection for the app, else workspace default (`isDefault`),
else 400 with candidates. Never silently pick “oldest” / “first created”.

Built-in HTTP catalogue action (no connection): `http` /
`http_action_send-request`.

---

## 5c. Recipe: define*, runs.start, and CLI deploy

Pure typed config (no network):

```typescript
import {
  defineAction,
  defineAgent,
  defineTrigger,
  defineWorkflow,
  ref,
} from '@lunnoa/client';

export const ping = defineWorkflow({
  slug: 'ping',
  // Omit trigger for Manually Run with no input fields.
  steps: [
    {
      use: defineAction({
        id: 'http_action_send-request',
        input: { method: 'GET', url: 'https://example.com' },
      }),
    },
  ],
});

export const syncOrders = defineWorkflow({
  slug: 'sync-orders',
  trigger: defineTrigger({
    id: 'flow-control_trigger_manual',
    inputs: [
      { id: 'invoiceId', label: 'Invoice', inputType: 'text', required: true },
    ],
  }),
  steps: [
    {
      key: 'order',
      use: defineAction({
        id: 'http_action_send-request',
        input: {
          method: 'GET',
          url: `https://example.com/orders/${ref.trigger('invoiceId')}`,
        },
      }),
    },
    {
      use: defineAction({
        id: 'http_action_send-request',
        input: {
          method: 'GET',
          url: `https://example.com/status/${ref.step('order', 'response', 'status')}`,
        },
      }),
    },
  ],
});

export const triage = defineAgent({
  slug: 'support-triage',
  // models[].id from `npx @lunnoa/client ai-connections list --json`
  model: 'deepseek-ai/DeepSeek-V4-Pro',
  instructions: 'Triage mail. Be concise.',
  tools: [defineAction({ id: 'http_action_send-request' })],
});
```

Ad-hoc multi-step run (one Execution, `source: SDK`). `runs.start` sends
steps only. A `trigger` on the definition is ignored. Deploy to persist it.

```typescript
const result = await lunnoa.runs.start(ping);
// or lunnoa.runs.startAndWait(ping)
```

One catalogue trigger per deployed workflow:

- **Manually Run** (`flow-control_trigger_manual`): `inputs` is the caller
  form. It is stored as `customInputConfig`. `workflows.execute(id, { invoiceId })`
  passes those keys.
- **Listen for Webhook** (`flow-control_trigger_listen-for-webhook`):
  `input: { method: 'POST' }` (`PUT` or `GET` too).
- **Recurring Schedule** (`flow-control_trigger_recurring-schedule`): `input`
  from the catalogue (`start`, `rrule`). A schedule that cannot compute its
  next run fails the deploy.
- **Any other trigger:** `id` from `apps get`, optional `connection`, and
  `input` copied from that trigger's `inputConfig`. Do not invent ids.

### Passing data between steps

Wire step settings in code with `ref`. Do not leave them for the builder.

- `ref.trigger('caseId')`: a trigger output field. On Manually Run that is
  one of the `inputs` ids. On a webhook it is the request shape
  (`ref.trigger('body', 'caseId')`).
- `ref.step('load', 'rows', 0, 'status')`: an earlier step's output. Give
  that step a `key: 'load'`. Array indexes are numbers.
- A `ref` is a plain string. Use it as a whole value, inside a template
  string, or inside nested settings (`args: { case_id: ref.trigger('caseId') }`).
- On deploy the server swaps each `ref` for the real node id. The builder
  shows it as a mapped field from that earlier node (top-level text fields
  and lists; nested settings show the reference text). `runs.start` resolves
  `ref.step` too, but it has no trigger, so `ref.trigger` fails there.
- `defineWorkflow` throws, and deploy returns 400, for an unknown key, a
  reference to the same or a later step, a duplicate key, or a Manually Run
  field missing from `inputs`.
- To find a step's output path, run it once (`actions.run` or
  `runs.startAndWait`) and read that step's output in the execution.
- Give every step another step reads from a `key`. Keyed steps keep their
  node id across deploys, so run history and builder mappings stay attached.
  The trigger keeps its id while its type and settings stay the same.

### Branches (paths)

Put `paths` on the **last** step of a list. Steps after the branch go inside
each path. Paths do not merge back together.

```ts
const approval = defineAction({ id: 'flow-control_action_request-approval', input: { /* from tools get */ } });
const split = defineAction({ id: 'flow-control_action_conditional-paths' });

steps: [
  { key: 'review', use: approval, paths: [
    { label: 'Approved', steps: [{ key: 'apply', use: applyChange }] },
    { label: 'Rejected', steps: [{ use: notify, input: { text: ref.step('review', 'comment') } }] },
  ] },
]

// Conditional Paths: groups in `when` are OR-ed, conditions in a group AND-ed.
{ key: 'route', use: split, paths: [
  { label: 'Large', when: [[{ field: ref.step('load', 'amount'), condition: 'is_greater_than', value: '1000' }]], steps: [...] },
  { label: 'Other', steps: [...] }, // no `when`: always taken
] }
```

- `paths` works on Request Approval (at most two: approved first, then
  rejected; labels `Approved` / `Rejected`), Conditional Paths (with `when`),
  and Manually Decide Path (no `when`).
- `when` conditions: `field` is exactly one `ref.trigger` / `ref.step`.
  `condition` is one of `PATH_CONDITIONS` (equals, contains, is_empty,
  is_true, is_greater_than, is_less_than, matches_regex, is_in_the_past, ...).
  `value` is text; omit it for exists / is_empty / is_true style conditions.
- Conditional Paths takes every path whose `when` matches. A path without
  `when` always runs. For if/else, give the else path the opposite condition.
- Steps on a path can `ref.step` the branching step and earlier steps on
  the same path, not steps on another path.
- `runs.start` rejects `paths`. Deploy, then execute the workflow.

Discover the catalogue **before** writing `defineAction` (do not guess ids):

```bash
npx @lunnoa/client tools list --json --for-agent
npx @lunnoa/client tools search email --json --for-agent
npx @lunnoa/client tools get http_action_send-request --json
npx @lunnoa/client apps get flow-control --json
npx @lunnoa/client connections list --app gmail --json
npx @lunnoa/client ai-connections list --json
```

`tools get` returns `inputConfig` / `inputFields` and a `defineAction` sketch.
`tools list` is compact; use `get` for the schema. `apps get --json` returns
`triggers[]` with `triggerId`, `inputFields`, and a `defineTrigger` sketch.
`--json` is for coding agents. Do not invent trigger ids.

`ai-connections list` returns the AI connections this key can assign to an
agent. Set `defineAgent({ model })` to a `models[].id` from that JSON
(on Lunnoa LLMs that is a catalogue id such as
`deepseek-ai/DeepSeek-V4-Pro`). Omit `aiConnection` to
use the connection with `isDefault: true`. Pass
`defineAiConnection({ id })` only for a different connection. SDK:
`lunnoa.aiConnections.list()`.

Deploy to Automate UI (upsert by slug inside the workspace on the API key; prefer CLI):

```bash
npx @lunnoa/client workflows deploy ./ping.ts --url … --api-key …
npx @lunnoa/client agents deploy ./triage.ts --url … --api-key …
```

`defineAction` binds catalogue actions only. Toolkit `createAction` is a
different job (in-platform apps).

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

A turn from an app runs in **preview**: 10 model rounds, so the agent can call tools a few times and still send a final reply. The SDK sends `chatMode: 'preview'` for you. Do not pass `chatMode: 'builder'` from an app. That is the agent-editor interview: 4 rounds, and it stops a tool-using agent halfway. The workflow then fails with "Agent did not generate a response" even when a tool already saved the data. A workflow Message Agent step uses the same preview budget. For a job that chains many tool calls (read every record, then write a result), turn on **Long-horizon mode** on that agent in Lunnoa. That raises the budget to 50 rounds. `defineAgent` cannot set the switch, and a later deploy leaves it as you set it.

- **React apps:** prefer `useAgentChat` from `@lunnoa/client/react`, which wraps AI SDK `useChat` + `DefaultChatTransport`
  pointed at
  `${baseUrl}/api/agents/${agentId}/tasks/${taskId}/stream-message` with an
  `Authorization` header. You can also wire `useChat` yourself. Use
  `@lunnoa/client` for everything non-chat.
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

Queues are the platform's work-item surface for review UIs. Items can
optionally link to an **Object** (entity) via `objectId` — the business
record the work is about. Creating a queue item does **not** create an Object.

```typescript
const queues = await lunnoa.queues.list();
const { items } = await lunnoa.queueItems.list(queueId, { limit: 50 });
for await (const item of lunnoa.queueItems.iterate(queueId)) { ... }
await lunnoa.queueItems.updateStatus(queueId, itemId, 'SUCCESS');

// Restrict which ObjectTypes a queue accepts (empty = any)
await lunnoa.queues.create({
  name: 'IT triage',
  allowedObjectTypeIds: [ticketType.id],
});

// Link work to an existing Object
await lunnoa.queueItems.create(triageQueueId, {
  objectId: ticket.id,
  externalId: ticket.id,
  data: { priority: 'high' },
});

// Work panel for that Object (across all queues)
const { items: work } = await lunnoa.queueItems.listByObject(ticket.id);
```

---

## 9. Recipe: Approvals inbox (Request Approval nodes)

`lunnoa.approvals` mirrors Automate **Approvals** (`/approvals`). It uses the
workspace API (`/api/approvals/...`), not Public API v1. The inbox is filtered
to requests where the **current user** is eligible and has not decided yet.
The caller is the signed-in Lunnoa user. Role needs `approvals:read` / `approvals:decide`.

```typescript
const { items } = await lunnoa.approvals.inbox(); // pending + partially_approved

for (const person of items[0]?.eligibleApprovers ?? []) {
  // person.workspaceUserId, email, name?
  console.log(person.email);
}

await lunnoa.approvals.decide(items[0]!.approvalId, {
  decision: 'approved', // or 'rejected'
  comment: 'Within policy limits.',
});

// Or when you already have executionId + nodeId:
await lunnoa.executions.submitApproval(executionId, nodeId, {
  decision: 'rejected',
  comment: 'Amount exceeds limit.',
});
```

Do **not** use `submitInput` for Request Approval nodes; that is for generic
`NEEDS_INPUT` forms. Partial approvals keep the execution paused; terminal
decisions resume it. `eligibleApprovers` is the people who can still decide,
with emails (capped; not Azure object IDs).

---

## 10. Ship checklist (after the mandatory checklist)

1. Confirm the base URL. Sign people in with `createBrowserClient` and
   `lunnoa.auth.login` (not an `lna_` key, and not raw localStorage getters
   unless you already hold that user's JWT). Allow the origin in
   `CORS_ALLOWED_ORIGINS`.
2. Run `npx @lunnoa/client codegen` against the deployment; commit the output.
3. Call `discovery.enabledFeatures()` and hide unsupported areas.
4. Build forms/tables from `attributeSchema` / `customInputConfig` (or the generated types).
5. Render workflow progress from `executionPath`; handle `NEEDS_INPUT` with `submitInput`.
6. For single-action calls, use `actions.run`; for linear multi-step, use `runs.start` / `defineWorkflow`. Deploy with `npx @lunnoa/client workflows|agents deploy`. Discover actions via `npx @lunnoa/client tools list|get|search` (or `workflowApps.list()`). Discover triggers via `apps get <appId> --json` and pass `defineTrigger` on `defineWorkflow` (omit it for Manually Run with no fields). `runs.start` does not save the trigger. Pass trigger inputs and earlier step outputs into step settings with `ref.trigger` / `ref.step` (key the source step). Branch with `paths` on Request Approval or Conditional Paths (last step only). Discover agent models via `npx @lunnoa/client ai-connections list --json` (or `aiConnections.list()`).
7. For Request Approval nodes, use `approvals.inbox` / `approvals.decide` (or `executions.submitApproval`).
8. Chat: stream via SSE, handle resume (reconnects) and stop, load history from the task.
9. Handle `LunnoaApiError`: 401 → re-auth; 403 → hide the capability; 429 → back off.
10. Do not use toolkit `createAction` when you meant client `defineAction`.
