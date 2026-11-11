## [2.5.0](https://github.com/lunnoa-automate/lunnoa_client/compare/v2.4.0...v2.5.0) (2026-11-11)

### Features

* **define:** paths on workflow steps for approve/reject and conditional branches ([a22b4b9](https://github.com/lunnoa-automate/lunnoa_client/commit/a22b4b990bfbc3626f280c09912593d747457b4e))

## [2.4.0](https://github.com/lunnoa-automate/lunnoa_client/compare/v2.3.0...v2.4.0) (2026-11-06)

### Features

* pass trigger inputs and step outputs into steps with ref ([958ce65](https://github.com/lunnoa-automate/lunnoa_client/commit/958ce65da8a06780ae13e50ce3cb24a7fd0c4294))

## [2.3.0](https://github.com/lunnoa-automate/lunnoa_client/compare/v2.2.0...v2.3.0) (2026-11-06)

### Features

* declare a workflow trigger from defineWorkflow ([566e7c0](https://github.com/lunnoa-automate/lunnoa_client/commit/566e7c0354ff12dd8c82a9b7ce74feaa8ee24096))

## [2.2.0](https://github.com/lunnoa-automate/lunnoa_client/compare/v2.1.0...v2.2.0) (2026-11-05)

### Features

* run app agent chats in preview mode and list AI connections ([2314d70](https://github.com/lunnoa-automate/lunnoa_client/commit/2314d708089800c527f5d357fef2712da60eaa12))

## [2.1.0](https://github.com/lunnoa-automate/lunnoa_client/compare/v2.0.0...v2.1.0) (2026-11-04)

### Features

* sign custom apps in as Lunnoa users ([3cba81c](https://github.com/lunnoa-automate/lunnoa_client/commit/3cba81cdab7b43e9ec8273b2c4cdf0e824cedee6))

### Bug Fixes

* drop projectId from the executions filter ([12008fa](https://github.com/lunnoa-automate/lunnoa_client/commit/12008fa02cf004c25f25bf50389b927679b4838d))

## [2.0.0](https://github.com/lunnoa-automate/lunnoa_client/compare/v1.5.0...v2.0.0) (2026-11-04)

### ⚠ BREAKING CHANGES

* drop project scoping from the client

### Features

* drop project scoping from the client ([2b319c4](https://github.com/lunnoa-automate/lunnoa_client/commit/2b319c49b4e931370f13bc6bd5dda5ff59f1434b))

## [2.0.0](https://github.com/lunnoa-automate/lunnoa_client/compare/v1.5.0...v2.0.0) (2026-11-04)

### ⚠ BREAKING CHANGES

* Projects are gone. `client.projects`, `ProjectsResource`, `Project`, and `CreateProjectInput` are removed. `--project-id`, `LUNNOA_PROJECT_ID`, `lunnoa.config` `projectId`, and the `projects list` command are removed. `agents deploy` and `workflows deploy` need only the URL and API key.
* `agents.upsertBySlug` and `workflows.upsertBySlug` take the body only and post to `POST /api/agents/upsert` and `POST /api/workflows/upsert`. The old `/api/projects/.../upsert` URLs return 404. An existing slug in the workspace still updates that agent.
* `actions.run`, `runs.start`, and `tables.list` no longer accept `projectId`.
* Existing apps must upgrade and run `npx @lunnoa/client skills install` so `.cursor/skills` and `.claude/skills` refresh.

## [1.5.0](https://github.com/lunnoa-automate/lunnoa_client/compare/v1.4.0...v1.5.0) (2026-11-04)

### Features

* add tables resource ([a1a6ac3](https://github.com/lunnoa-automate/lunnoa_client/commit/a1a6ac339024d9e636f6c7585f924d33336c6487))
* **cli:** add init command, tables commands and .env loading ([314bdf7](https://github.com/lunnoa-automate/lunnoa_client/commit/314bdf727cc5436f7a69b32fa386cb9f1991cd5b))

### Bug Fixes

* **react:** use in-memory token store during SSR ([d3592d3](https://github.com/lunnoa-automate/lunnoa_client/commit/d3592d37cfdb3a568986e34c1092e0ce71195837))

## [1.4.0](https://github.com/lunnoa-automate/lunnoa_client/compare/v1.3.0...v1.4.0) (2026-11-04)

### Features

* add a CLI command to install bundled agent skills ([4700d9a](https://github.com/lunnoa-automate/lunnoa_client/commit/4700d9a307435acdfe0b097eb20dcfdea809255a))

## [1.3.0](https://github.com/lunnoa-automate/lunnoa_client/compare/v1.2.0...v1.3.0) (2026-10-21)

### Features

* add scorecards resource for recording measure values ([d873c08](https://github.com/lunnoa-automate/lunnoa_client/commit/d873c0854542f8eff7182a24ed8ee1d095dfd0be))
* match the client to the current Automate API ([a292514](https://github.com/lunnoa-automate/lunnoa_client/commit/a292514a0aed4f2aaef4f855a53db4e0cc43ca23))

## [1.2.0](https://github.com/lunnoa-automate/lunnoa_client/compare/v1.1.0...v1.2.0) (2026-08-26)

### Features

* add CLI catalogue discovery commands ([cc40322](https://github.com/lunnoa-automate/lunnoa_client/commit/cc403228bc12360a7f625553514b9d1e1da12db7))

## 1.0.0 (2026-08-05)

### Features

* add define* factories, runs.start, and CLI deploy ([0ecc9d0](https://github.com/lunnoa-automate/lunnoa_client/commit/0ecc9d0b13d5a694ca0cc5371487d0ffec37edbd))
* add public OpenAPI spec and generated API types (codegen:spec) ([a2e6fbf](https://github.com/lunnoa-automate/lunnoa_client/commit/a2e6fbf5aee969ef208f7e0f1e13e4f97d7e1340))
* deployment codegen CLI (npx @lunnoa/client codegen) ([3e0bf75](https://github.com/lunnoa-automate/lunnoa_client/commit/3e0bf758c450920b5c76d3a79538fd3bc5c8ed7c))
* extend queue items client and sync OpenAPI schema ([cffb3de](https://github.com/lunnoa-automate/lunnoa_client/commit/cffb3de4a694544c6aa1d67a8529d9125b79487d))
* typed client core with resource namespaces, SSE agent chat streaming, and workflow helpers ([11511fe](https://github.com/lunnoa-automate/lunnoa_client/commit/11511feaf4ebca9df5b31933b22d6db0609934f8))

### Bug Fixes

* executions ([7844e48](https://github.com/lunnoa-automate/lunnoa_client/commit/7844e48a4dd7441e07181d0f756f0ea0e85b9480))
* make @lunnoa/client publish-ready for first npm release ([18874e2](https://github.com/lunnoa-automate/lunnoa_client/commit/18874e2d458b943b8e76de1df22991172ae6035d))

## 1.0.0 (2026-08-05)

### Features

* add define* factories, runs.start, and CLI deploy ([0ecc9d0](https://github.com/lunnoa-automate/lunnoa_client/commit/0ecc9d0b13d5a694ca0cc5371487d0ffec37edbd))
* add public OpenAPI spec and generated API types (codegen:spec) ([a2e6fbf](https://github.com/lunnoa-automate/lunnoa_client/commit/a2e6fbf5aee969ef208f7e0f1e13e4f97d7e1340))
* deployment codegen CLI (npx @lunnoa/client codegen) ([3e0bf75](https://github.com/lunnoa-automate/lunnoa_client/commit/3e0bf758c450920b5c76d3a79538fd3bc5c8ed7c))
* extend queue items client and sync OpenAPI schema ([cffb3de](https://github.com/lunnoa-automate/lunnoa_client/commit/cffb3de4a694544c6aa1d67a8529d9125b79487d))
* typed client core with resource namespaces, SSE agent chat streaming, and workflow helpers ([11511fe](https://github.com/lunnoa-automate/lunnoa_client/commit/11511feaf4ebca9df5b31933b22d6db0609934f8))

### Bug Fixes

* executions ([7844e48](https://github.com/lunnoa-automate/lunnoa_client/commit/7844e48a4dd7441e07181d0f756f0ea0e85b9480))
* make @lunnoa/client publish-ready for first npm release ([18874e2](https://github.com/lunnoa-automate/lunnoa_client/commit/18874e2d458b943b8e76de1df22991172ae6035d))
