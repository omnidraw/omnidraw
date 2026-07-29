# Tool workflow

The fixed tool set is intentionally small. Use only tools that are present. There is no model-callable publish, Preview, approval, rejection, or resource-binding tool.

For a new widget:

1. Use `vc_widget_create({ name, description?, template?, server? })` exactly
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
   Vibecanvas host process's filesystem, process, environment, executable
   lookup, and network authority. Quote paths and avoid destructive commands
   unless the user explicitly requested them.
4. Add or change exact npm dependencies only through `package.json`. The host
   runs `npm install` and records the resulting lockfile. Preserve the generated
   `npm run build`/Vite contract unless the widget genuinely requires a build
   adjustment, and ensure it still emits `dist/main.js`.
   During the current testing phase, retain the generated direct
   `@omnidraw/capsule` dependency: the linked SDK needs it for build-time
   resolution even though widget source must import only `@vibecanvas/sdk`.
5. Use the generated `server/main.server.ts` only when local browser logic
   cannot satisfy the request. Edit its starter export instead of adding a
   second server entry or retrofitting the generated manifest.
6. Run `vc_widget_validate`; it performs the frozen install when dependency
   inputs require it and completes the guest build and Capsule distribution
   validation, or reuses the open Preview's unchanged completed construction.
   Inspect every diagnostic and fix all errors. If a durable Preview is open,
   committed edits already trigger its latest-wins rebuild; do not poll or
   invent a refresh loop.
7. Stop after a validated draft. The AI cannot publish a draft; only a direct
   user action starting from the draft Preview title bar or draft detail page
   can Publish or **Republish**. Either surface must resolve the exact ready
   frame-owned Preview revision; never suggest a source-only publish.

Use resource discovery and inspection only when the user selected or requested shared data. Protected database or secret changes require host approval. Never bypass an approval, expose a secret, copy a host path, or turn validation into publication.

Shell access does not manufacture approval, publication, protected resource
mutation, or other authoritative product results. Use the dedicated workflows
for those operations.

Do not create timers, sleeps, retry loops, background workers, HTTP handlers, state-machine runtimes, or durable guest processes. Short server calls are scheduled and bounded by the host.
