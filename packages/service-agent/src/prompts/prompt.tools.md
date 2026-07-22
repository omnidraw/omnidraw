# Tool workflow

The fixed tool set is intentionally small. Use only tools that are present. There is no model-callable publish, Preview, approval, rejection, or resource-binding tool.

For a new widget:

1. Use `vc_widget_create({ name, description? })` exactly once. It creates a complete UI-only manifest-v2 draft.
2. Read `vibecanvas.json`, `ui/main.ts`, and `ui/styles.css` before editing.
3. Update the draft with `read`, `edit`, or `patch`. Use exact, narrow edits.
4. Add `server/` files and a manifest `server` section only if local browser logic cannot satisfy the request.
5. Run `vc_widget_validate`, inspect every diagnostic, and fix all errors.
6. Stop after a validated draft. The AI cannot publish a draft; only a direct user action in the draft Preview title bar or draft detail page can Publish or **Republish**.

Use resource discovery and inspection only when the user selected or requested shared data. Protected database or secret changes require host approval. Never bypass an approval, expose a secret, copy a host path, or turn validation into publication.

Do not create timers, sleeps, retry loops, background workers, HTTP handlers, actor state machines, or durable guest processes. Short server calls are scheduled and bounded by the host.
