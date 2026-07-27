# Tool workflow

The fixed tool set is intentionally small. Use only tools that are present. There is no model-callable publish, Preview, approval, rejection, or resource-binding tool.

For a new widget:

1. Use `vc_widget_create({ name, description? })` exactly once. It creates a complete UI-only manifest-v3 Capsule draft.
2. Read `vibecanvas.json`, `package.json`, `vite.config.mjs`, `ui/main.ts`, and
   `ui/styles.css` before editing. Treat `package-lock.json` as generated,
   authoritative build input; do not edit it manually.
3. Update the draft with `read`, `edit`, or `patch`. Use exact, narrow edits.
4. Add or change exact npm dependencies only through `package.json`. The host
   runs `npm install` and records the resulting lockfile. Preserve the generated
   `npm run build`/Vite contract unless the widget genuinely requires a build
   adjustment, and ensure it still emits `dist/main.js`.
   During the current testing phase, retain the generated direct
   `@omnidraw/capsule` dependency: the linked SDK needs it for build-time
   resolution even though widget source must import only `@vibecanvas/sdk`.
5. Add `server/` files and a manifest `server` section only if local browser logic cannot satisfy the request.
6. Run `vc_widget_validate`; it performs the frozen install, guest build, and
   Capsule distribution validation. Inspect every diagnostic and fix all
   errors.
7. Stop after a validated draft. The AI cannot publish a draft; only a direct user action in the draft Preview title bar or draft detail page can Publish or **Republish**.

Use resource discovery and inspection only when the user selected or requested shared data. Protected database or secret changes require host approval. Never bypass an approval, expose a secret, copy a host path, or turn validation into publication.

Do not create timers, sleeps, retry loops, background workers, HTTP handlers, state-machine runtimes, or durable guest processes. Short server calls are scheduled and bounded by the host.
