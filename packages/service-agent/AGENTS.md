# AGENTS.md — packages/service-agent

Service layer for Omnidraw AI/Pi agent integration.

## Package role

`@omnidraw/service-agent` owns stateful agent behavior and Pi SDK integration. It should expose small service methods for the API layer, not UI concepts.

Current service entrypoint:
- `src/AgentService.ts`
- `src/index.ts`

Current dependencies and responsibilities:
- Uses `@earendil-works/pi-coding-agent` for auth, models, settings, sessions, and custom tools.
- Stores Pi data under `join(config.dataPath, 'pi')`.
- Owns login sessions, abort controllers, model registry, settings manager, and widget/session managers.
- Owns independent chat transcripts, one shared widget-draft workspace, and the fixed AI Chat tool registry.
- May publish service events through `eventPublisherService` when agent runtime events are implemented.

## Known consumers

This package is not called directly by frontend code. The flow is:

1. Frontend UI calls the typed ORPC client.
2. `packages/api/src/agent` validates and exposes the API contract.
3. API handlers call `AgentService` methods through `context.agent`.
4. `AgentService` performs Pi/service-layer work and returns contract-shaped data.

Important files to inspect before changing public service behavior:
- `packages/api/src/agent/contract.ts`
- `packages/api/src/agent/types.ts`
- `packages/api/src/agent/api.setting.get.ts`
- `packages/api/src/agent/api.auth.login.ts`
- `packages/api/src/agent/api.auth.status.ts`
- `packages/api/src/agent/api.auth.abort.ts`
- `packages/ui-ai-chat/src/chat/components/index.tsx`
- `packages/ui-ai-chat/src/chat/components/tabs/SettingsTab.tsx`

Frontend entrypoint currently using this stack:
- `packages/ui-ai-chat/src/chat/components/index.tsx`
  - fetches `apiService.api.agent.settings.get({})`
  - treats `providersWithCredentials.length > 0` as authenticated
  - uses the settings response to choose default tab and render settings state

## API contract discipline

Keep `AgentService` return values aligned with `packages/api/src/agent/contract.ts`.

Current contract shape includes:
- `settings.get` returns default model/provider/thinking level, credentialed providers, available providers, and available models.
- `chat.connect` returns `{ vcJson, messageHistory, editSession }` for the requested widget/session.
- Current widget authority comes only from the shared draft folder. Canonical published snapshots and historical candidate entries are never current chat authority.
- `chat.prompt` sends user text to the connected widget/session and relies on `events` for streamed/results updates.
- `auth.login` accepts only `openai-codex` or `github-copilot` and returns `{ loginId }`.
- `auth.logout` accepts only `openai-codex` or `github-copilot` and removes stored OAuth credentials.
- `auth.status` returns a discriminated login status.
- `auth.abort` aborts a login by `loginId`.
- `auth.apiKey.set` stores an API key credential by provider id and never returns the key.
- `auth.apiKey.remove` removes a stored API key credential by provider id.
- `events` streams Pi agent session events published by `AgentService` through `IEventPublisherService`.

When changing service public methods:
- update `packages/api/src/agent` handlers and contract together
- consider frontend expectations in `AiChat`
- prefer additive changes when possible
- never return secrets or raw credentials to the API/frontend
- preserve discriminated union fields exactly; frontend and ORPC validation depend on them

## AI chat widget tools

Custom chat tools live in `src/tools/tool.*.ts`; only actual `defineTool(...)` factories should use the `tool.*.ts` prefix.

Every conversation receives exactly these 19 tools for its complete lifecycle:

- Widgets/files: `od_widget_list`, `od_widget_create`, `od_widget_validate`, `vc_widget_preview_status`, `vc_widget_preview_wait`, `vc_widget_preview_test`, `read`, `edit`, `patch`, `grep`
- Resources: `od_resource_list`, `od_resource_inspect`, `od_resource_create`, `od_resource_update`, `od_resource_delete`, `od_resource_data_read`, `od_resource_data_write`
- General: `web_fetch`, `bash`

There are no phases and no model-callable publish, approval, rejection, widget-delete, unload, symlink, or unrestricted file-write tools. `src/tools/ToolRegistry.ts` enforces the exact set. Authorization is checked on every call. Bash starts in the chat workspace but is not filesystem-isolated there. Production supplies one stateless host-authority capability backed by a fresh short-lived Bun PTY per call. It streams and retains bounded output, forwards timeout/cancellation, reports exact process settlement metadata, and closes the PTY after the child settles. Higher-level host or OS isolation owns confinement.

Chat filesystem ownership:

- `chats/<UTC-date>/<sessionId>/` owns `chat.json`, Pi `history/`, and one `workspace/` for a dated Omnidraw chat ID.
- `chats/legacy/<sessionId>/` provides the same layout for existing safe IDs whose creation date is not encoded.
- Canvas/API field `sessionId` is the stable Omnidraw chat ID and directory leaf. Pi transcript headers contain a separate Pi-owned session ID.
- `workspace/widgets/<name>` contains backend-owned links to shared drafts and remains the structured file-tool boundary.
- `widgets/drafts/<name>` is the shared editable folder mounted by independent chat workspaces.
- Build workspaces remain draft-private and warm while a Preview frame for that
  draft exists. Durable, content-addressed Preview revisions retain their exact
  source/UI/server artifacts and control metadata independently of that
  reconstructable workspace.
- `sdk` is the host-materialized `@omnidraw/sdk` package used by generated drafts and trusted validation in both source and compiled runtimes.
- Generic file access must enter through a validated `widgets/<name>` mount. Direct access to the shared draft root is rejected.
- `edit` and `patch` serialize a complete read/transform/atomic-rename transaction per real widget root.

Protected resource mutations use `src/approval/ApprovalCoordinator.ts`. The coordinator stores immutable exact arguments only in process memory, exposes a secret-safe approval view, rechecks authorization, and claims execution once. Secret-store set values are redacted before Pi event/transcript persistence and handed to the tool through a one-shot process-local vault.

Publishing remains a user-controlled API operation in `AgentService`. Publish
accepts the exact active, frame-owned Preview revision, rechecks draft and
binding authority, release-signs the retained canonical construction, and
atomically commits its already-built source, UI, and optional server artifacts
without rerunning guest build commands. Published catalog, detail, files,
placement, and edit-as-draft reads come only from that durable revision and its
verified source artifact. Every chat remains mounted to the editable draft, and
published slugs are immutable after first publication.

Draft Preview is a durable, full-stack authoring runtime owned by a Cangine
frame. Its verified UI invokes the exact active retained server revision through
real selected resource bindings. Open frames follow committed draft changes
through a latest-wins coordinator, retain the last good revision while building,
and close their backend owner/workspace when the frame is removed. A stateless
build request remains only as a compatibility surface; it is not the live
Cangine Preview model.

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
- bypass the consolidated API agent domain for frontend-facing behavior
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
- `packages/api` typecheck/tests
- canvas/frontend typecheck if changing shapes consumed by `AiChat`
