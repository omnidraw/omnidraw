# AGENTS.md — packages/service-agent

Service layer for Vibecanvas AI/Pi agent integration.

## Package role

`@vibecanvas/service-agent` owns stateful agent behavior and Pi SDK integration. It should expose small service methods for the API layer, not UI concepts.

Current service entrypoint:
- `src/AgentService.ts`
- `src/index.ts`

Current dependencies and responsibilities:
- Uses `@earendil-works/pi-coding-agent` for auth, models, settings, sessions, and custom tools.
- Stores Pi data under `join(config.dataPath, 'pi')`.
- Owns login sessions, abort controllers, model registry, settings manager, and widget/session managers.
- Owns AI widget wizard tool orchestration and phase-specific tool loading.
- May publish service events through `eventPublisherService` when agent runtime events are implemented.

## Known consumers

This package is not called directly by frontend code. The flow is:

1. Frontend UI calls the typed ORPC client.
2. `packages/api-agent` validates and exposes the API contract.
3. API handlers call `AgentService` methods through `context.agent`.
4. `AgentService` performs Pi/service-layer work and returns contract-shaped data.

Important files to inspect before changing public service behavior:
- `packages/api-agent/src/contract.ts`
- `packages/api-agent/src/types.ts`
- `packages/api-agent/src/api.setting.get.ts`
- `packages/api-agent/src/api.auth.login.ts`
- `packages/api-agent/src/api.auth.status.ts`
- `packages/api-agent/src/api.auth.abort.ts`
- `packages/canvas/src/components/AiWizzard/index.tsx`
- `packages/canvas/src/components/AiWizzard/tabs/SettingsTab.tsx`

Frontend entrypoint currently using this stack:
- `packages/canvas/src/components/AiWizzard/index.tsx`
  - fetches `apiService.api.agent.settings.get({})`
  - treats `providersWithCredentials.length > 0` as authenticated
  - uses the settings response to choose default tab and render settings state

## API contract discipline

Keep `AgentService` return values aligned with `packages/api-agent/src/contract.ts`.

Current contract shape includes:
- `settings.get` returns default model/provider/thinking level, credentialed providers, available providers, and available models.
- `wizzard.connect` returns `{ vcJson, actorCandidate, messageHistory }` for the requested widget/session.
- `actorCandidate` is `null` on first connect and otherwise the latest actor candidate custom entry saved in the Pi session.
- `wizzard.prompt` sends user text to the connected widget/session and relies on `events` for streamed/results updates.
- `auth.login` accepts only `openai-codex` or `github-copilot` and returns `{ loginId }`.
- `auth.logout` accepts only `openai-codex` or `github-copilot` and removes stored OAuth credentials.
- `auth.status` returns a discriminated login status.
- `auth.abort` aborts a login by `loginId`.
- `auth.apiKey.set` stores an API key credential by provider id and never returns the key.
- `auth.apiKey.remove` removes a stored API key credential by provider id.
- `events` streams Pi agent session events published by `AgentService` through `IEventPublisherService`.

When changing service public methods:
- update `api-agent` handlers and contract together
- consider frontend expectations in `AiWizzard`
- prefer additive changes when possible
- never return secrets or raw credentials to the API/frontend
- preserve discriminated union fields exactly; frontend and ORPC validation depend on them

## AI widget wizard tools

Custom wizard tools live in `src/tools/tool.*.ts`; only actual `defineTool(...)` factories should use the `tool.*.ts` prefix.

Current custom tools:
- `vc_set_actor_candidate`
  - Phase 1 only.
  - Accepts a full actor candidate and validates before saving.
  - Saves candidates with `sessionManager.appendCustomEntry`; do not write candidate files to cwd.
  - Uses a hand-authored TypeBox parameter schema in `src/tools/CONSTANTS.ts`; do not use `z.toJSONSchema` for this tool schema because model-facing constraints must be explicit.
- `vc_approve_actor_candidate`
  - Phase 1 only.
  - Reads the latest candidate from Pi session custom entries.
  - Writes scaffold files into the draft cwd, including `vibecanvas.json`, `package.json`, actor stubs, and widget files.
  - Attempts `npm install` when `package.json` exists; install failure should be returned in tool details and should not silently drop approval state.
  - Appends a `vibecanvas.actorCandidateApproved` custom entry when approval succeeds.
- `vc_validate_widget_files`
  - Phase 2 only.
  - Validates generated draft files and actor registry shape.
- `vc_publish_widget`
  - Phase 2 only.
  - Copies draft files to `<configPath>/widgets/<slug>` and reloads actor definitions when `actorService` is available.

Phase selection:
- `src/tools/phase-tools.ts` chooses phase from Pi session history and assembles phase-specific tools.
- No approval custom entry means phase 1 tools.
- Latest approval custom entry means phase 2 tools plus built-in `read`, `edit`, and `grep`.
- Phase 1 must not expose filesystem or bash tools.
- Phase 2 must not expose bash by default.

Shared candidate session helpers:
- `src/core/fx.session-candidate.ts`
- `src/core/tx.session-candidate.ts`

## Service-layer boundaries

Do:
- keep Pi SDK and persistence details inside this package
- expose boring service methods for API handlers
- return serializable DTOs that match API schemas
- inject side-effect dependencies through constructor config or service context
- keep durable data under `dataPath`
- make login/session lifecycle explicit and abortable

Do not:
- import frontend or SolidJS code
- encode UI labels, tab choices, CSS, or component state here
- bypass `api-agent` for frontend-facing behavior
- leak Pi SDK object instances through API return values
- expose API keys, tokens, auth files, or raw Pi auth records

## Functional core guidance

Follow root functional-core rules.

For new non-trivial logic:
- extract pure deterministic logic into local `fn.*.ts`
- extract impure reads into local `fx.*.ts`
- extract impure writes into local `tx.*.ts`
- keep `AgentService.ts` focused on orchestration and lifecycle
- use `src/core` only for shared service-agent logic that is reused across features
- keep `tool.*.ts` files as thin `defineTool(...)` factories; move shared logic to `fn.*`, `fx.*`, `tx.*`, `CONSTANTS.ts`, or `types.ts`

When editing `fn.*.ts`, `fx.*.ts`, or `tx.*.ts`, follow the repository file-type rules from the root `AGENTS.md` and active fn/fx/tx checks.

## Pi SDK notes

If changing Pi SDK integration, read the Pi package docs/examples first when needed:
- `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/README.md`
- related docs under `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/docs`
- examples under `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/examples`

Keep Pi-specific adapter behavior localized so the API contract remains stable if Pi internals change.

## Testing and verification

Useful commands from this package:
- `bun run typecheck`
- `bun test tests --timeout=20000`

Known current caveat:
- `bun run typecheck` may fail because of existing cross-package `service-db` SQL module/global typing issues. Still run it when touching public contracts and report whether failures are unrelated.

Also run/check API/frontend callers when public behavior changes:
- `packages/api-agent` typecheck/tests if available
- canvas/frontend typecheck if changing shapes consumed by `AiWizzard`
