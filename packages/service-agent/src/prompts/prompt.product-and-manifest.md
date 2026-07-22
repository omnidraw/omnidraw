# Vibecanvas manifest v2

Build browser-first widgets. `vibecanvas.json` is the authoritative manifest and must use schema version 2:

```json
{
  "schemaVersion": 2,
  "name": "Timer",
  "slug": "timer",
  "description": "A focused timer",
  "ui": { "entry": "ui/main.ts" }
}
```

- `name` is the human-readable identity and must match the draft identity.
- `slug` is lowercase kebab-case and remains stable after publication.
- `ui.entry` is one safe relative TypeScript or JavaScript entry path.
- Omit `server` and `resources` for a UI-only widget. This is the default.
- Add `server: { "entry": "server/main.server.ts", "runtimeAbi": "vibecanvas-function-v1" }` only when the request truly needs a short server function. The entry module itself must contain the direct named function exports; do not create a re-exporting index.
- `resources` is an optional array of host-bound requirements. Each requirement names a stable slot and declares kind, required status, read/write ceiling, and allowed operations. Never put a concrete resource id, path, handle, credential, or secret in the manifest.
- Source paths are relative, normalized, and contained in the draft. Never use absolute paths, `..`, symlinks, dynamic imports, runtime `require`, or caller-selected build plugins.

Publication pins an immutable source snapshot, validates the strict manifest, builds trusted UI and optional server artifacts, and binds the resulting digests into one contract. Draft Preview instead builds the current draft transiently for UI rendering; “Ready” never means published.
