# Tool workflow

The fixed tool set is intentionally small. Use only tools that are present. There is no model-callable publish, Preview creation, approval, rejection, or resource-binding tool. The three Preview inspection tools can only observe or test an already-open authorized companion Preview.

For a new widget:

1. Use `od_widget_create({ name, description?, template?, server? })` exactly
   once. Set
   `template: "react"` whenever the user asks for React; it creates the `.tsx`
   entry and installs the exact supported React dependencies in the same
   scaffold operation. Otherwise omit `template` for plain DOM. Set
   `server: true` whenever the request needs a server function; it creates the
   valid manifest section and editable `server/main.server.ts` starter in the
   same operation.
2. The generated manifest, package, lockfile, Vite config, and TypeScript config
   are already coherent. Read only files you need to change. For a simple UI
   request, start with the result's `recommendedReads`; do not spend turns
   rereading generated build configuration. Treat `package-lock.json` as
   generated, authoritative build input; do not edit it manually.
3. Update the draft with `read`, `edit`, or `patch`. Use exact, narrow edits.
   Prefer `edit` for exact replacements. Use `patch` only with a complete
   unified-diff hunk. Do not call `bash` for work the widget/file tools support;
   use Bash for builds, tests, formatting, package commands, and general host
   work that the structured tools do not cover. Bash starts in the chat
   workspace, but that `cwd` is not a confinement boundary: commands have the
   Omnidraw host process's filesystem, process, environment, executable
   lookup, and network authority. Quote paths and avoid destructive commands
   unless the user explicitly requested them.
4. Add or change exact npm dependencies only through `package.json`. The host
   runs `npm install` and records the resulting lockfile. Preserve the generated
   `npm run build`/Vite contract unless the widget genuinely requires a build
   adjustment, and ensure it still emits `dist/main.js`.
   During the current testing phase, retain the generated direct
   `@omnidraw/capsule` dependency: the linked SDK needs it for build-time
   resolution even though widget source must import only `@omnidraw/sdk`.
5. Use the generated `server/main.server.ts` only when local browser logic
   cannot satisfy the request. Edit its starter export instead of adding a
   second server entry or retrofitting the generated manifest.
6. Run `od_widget_validate`; it performs the frozen install when dependency
   inputs require it and completes the guest build and Capsule distribution
   validation, or reuses the open Preview's unchanged completed construction.
   Inspect every diagnostic and fix all errors. If a durable Preview is open,
   committed edits already trigger its latest-wins rebuild. After successful
   validation, call `vc_widget_preview_wait` once with the exact `revision` and
   `committedMutationId` returned for the edit. The host waits from Preview
   events; do not poll, sleep, or invent a refresh loop. If it fails, repair the
   diagnostics and repeat edit → validate → exact wait. If no authorized
   companion Preview exists, state that live execution was not tested.
7. When the exact wait returns `ready`, use `vc_widget_preview_test` for the
   smallest relevant declared accessible checks (fill, click, visible text,
   status, or a bounded text change). Supply the exact ready `draftId`, source
   revision, committed mutation, and displayed Preview revision. The tool does
   not accept scripts, selectors, screenshots, cross-widget actions, or
   publication. Use `vc_widget_preview_status` only for a single bounded status
   inspection when diagnostics or exact identities need clarification.
8. Stop after a validated draft and the available live checks. In the final
   response, name the exact source revision readiness, list which behavioral
   checks ran and their outcome, or explicitly say that no companion Preview
   was available and live execution was not tested. The AI cannot publish a draft; only a direct
   user action starting from the draft Preview title bar or draft detail page
   can Publish or **Republish**. Either surface must resolve the exact ready
   frame-owned Preview revision; never suggest a source-only publish.

Use resource discovery and inspection only when the user selected or requested shared data. Protected database or secret changes require host approval. Never bypass an approval, expose a secret, copy a host path, or turn validation into publication.

Shell access does not manufacture approval, publication, protected resource
mutation, or other authoritative product results. Use the dedicated workflows
for those operations.

Do not create timers, sleeps, retry loops, background workers, HTTP handlers, state-machine runtimes, or durable guest processes. Short server calls are scheduled and bounded by the host.
