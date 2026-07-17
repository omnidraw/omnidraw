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
- Owns isolated chat workspaces, shared widget mounts, and the fixed AI Chat tool registry.
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
- `packages/canvas/src/components/AiChat/index.tsx`
- `packages/canvas/src/components/AiChat/tabs/SettingsTab.tsx`

Frontend entrypoint currently using this stack:
- `packages/canvas/src/components/AiChat/index.tsx`
  - fetches `apiService.api.agent.settings.get({})`
  - treats `providersWithCredentials.length > 0` as authenticated
  - uses the settings response to choose default tab and render settings state

## API contract discipline

Keep `AgentService` return values aligned with `packages/api-agent/src/contract.ts`.

Current contract shape includes:
- `settings.get` returns default model/provider/thinking level, credentialed providers, available providers, and available models.
- `chat.connect` returns `{ vcJson, messageHistory, editSession }` for the requested widget/session.
- Current widget authority comes only from an explicitly mounted shared draft folder. Canonical published snapshots and historical candidate entries are never current chat authority.
- `chat.prompt` sends user text to the connected widget/session and relies on `events` for streamed/results updates.
- `auth.login` accepts only `openai-codex` or `github-copilot` and returns `{ loginId }`.
- `auth.logout` accepts only `openai-codex` or `github-copilot` and removes stored OAuth credentials.
- `auth.status` returns a discriminated login status.
- `auth.abort` aborts a login by `loginId`.
- `auth.apiKey.set` stores an API key credential by provider id and never returns the key.
- `auth.apiKey.remove` removes a stored API key credential by provider id.
- `events` streams Pi agent session events published by `AgentService` through `IEventPublisherService`.

When changing service public methods:
- update `api-agent` handlers and contract together
- consider frontend expectations in `AiChat`
- prefer additive changes when possible
- never return secrets or raw credentials to the API/frontend
- preserve discriminated union fields exactly; frontend and ORPC validation depend on them

## AI chat widget tools

Custom chat tools live in `src/tools/tool.*.ts`; only actual `defineTool(...)` factories should use the `tool.*.ts` prefix.

Every conversation receives exactly these 15 tools for its complete lifecycle:

- Widgets/files: `vc_widget_create`, `vc_widget_load`, `vc_widget_validate`, `read`, `edit`, `patch`, `grep`
- Resources: `vc_resource_list`, `vc_resource_inspect`, `vc_resource_create`, `vc_resource_update`, `vc_resource_delete`, `vc_resource_data_read`, `vc_resource_data_write`
- Network: `web_fetch`

There are no phases and no model-callable publish, approval, rejection, widget-delete, unload, symlink, bash, or unrestricted write tools. `src/tools/ToolRegistry.ts` enforces the exact set. Authorization is checked on every call.

Chat filesystem ownership:

- `chat-cwd/<chat-id>/widgets` belongs to one conversation and contains only backend-created mounts.
- `widget-cwd/<name>` is the canonical published snapshot and is never mounted into AI Chat.
- `widget-drafts/<name>` is the shared editable folder mounted by AI Chat, whether newly created or explicitly synced from published.
- `sdk` is the host-materialized `@vibecanvas/sdk` package used by generated drafts and trusted validation in both source and compiled runtimes.
- Generic file access must enter through a validated `widgets/<name>` mount. Direct access to either shared root is rejected.
- `edit` and `patch` serialize a complete read/transform/atomic-rename transaction per real widget root.

Protected resource mutations use `src/approval/ApprovalCoordinator.ts`. The coordinator stores immutable exact arguments only in process memory, exposes a secret-safe approval view, rechecks authorization, and claims execution once. Secret-store set values are redacted before Pi event/transcript persistence and handed to the tool through a one-shot process-local vault.

Publishing remains a user-controlled API operation in `AgentService`. Publish snapshots the selected draft into the canonical root while every chat stays mounted to the draft; failure restores the previous canonical and installed snapshots and leaves drafts and mounts intact.

Shared current session-record helpers:

- `src/core/fx.session-records.ts`
- `src/core/tx.session-records.ts`

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

Also run/check API/frontend callers when public behavior changes:
- `packages/api-agent` typecheck/tests if available
- canvas/frontend typecheck if changing shapes consumed by `AiChat`
