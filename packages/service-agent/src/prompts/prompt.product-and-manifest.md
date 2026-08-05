# Omnidraw manifest v1

Build browser-first widgets. `omnidraw.json` is the authoritative manifest
and must use schema version 1. Version 1 is the only accepted version: there
is no older format, no upgrade path, and no compatibility reader. Never
rewrite, downgrade, or restructure the scaffolded manifest; edit only the
fields the request actually changes.

```json
{
  "$schema": "https://omnidraw.dev/schemas/widget/v1.json",
  "schemaVersion": 1,
  "slug": "timer",
  "name": "Timer",
  "description": "A focused timer",
  "tool": {
    "label": "Timer",
    "group": null,
    "priority": 0
  },
  "ui": {
    "runtime": "capsule",
    "entry": "ui/main.ts",
    "apis": ["DOM"]
  }
}
```

- `$schema` is exactly `https://omnidraw.dev/schemas/widget/v1.json`.
- `schemaVersion` is exactly `1`.
- `slug` is the stable widget key: lowercase kebab-case, 1-100 bytes. The
  draft folder is `widgets/drafts/<slug>/`, so the folder name and the slug
  must always match. Never rename `slug` after creation.
- `name` is the human-readable display name and must match the draft
  identity. The chat workspace mounts the draft by this name.
- `description` is one required human sentence.
- `tool` is required and strict: `label` is the sidebar/toolbar label,
  `group` is an optional lowercase kebab-case sidebar group or `null`,
  `priority` is an integer from -1000 to 1000, and `icon` is an optional
  pinned Lucide icon name or bounded inline SVG.
- Every section is strict: unknown fields are validation errors. Never add
  runtime ABI names, DOM profiles, feature profiles, resolved targets, bundle
  digests, or host limits.
- `ui.runtime` is always `capsule`; `ui.entry` is one safe relative TypeScript
  or JavaScript entry path.
- `ui.apis` requests Capsule public API groups. `DOM` is explicit and mandatory.
  Add only the groups the source needs. `CANVAS_2D`, `WEBGL`, and `WEBGPU` are
  mutually exclusive.
- `ui.budgets` may request non-negative Capsule ceilings for `cpuMs`,
  `memoryBytes`, `domNodes`, `handles`, `messageBytes`, `streamBytes`,
  `assetBytes`, `networkBytes`, `gpuBytes`, and `lifecycleBytes`. Omit it to use
  Capsule's selected-group defaults. Zero explicitly denies that dimension.
- Do not claim that live Preview interaction passed unless the current process
  actually ran it for the exact draft digest.
- Add `ui.state` only when needed. `collaborative` declares shared
  widget-instance state; `localStore` is `none` or `ephemeral`.
- Parking is unavailable in this release. Do not request it.
- Omit `server` and `resources` for a UI-only widget. This is the default.
- Add `server: { "entry": "server/main.server.ts", "runtimeAbi": "omnidraw-function-v1" }` only when the request truly needs a short server function. The entry module itself must contain the direct named function exports; do not create a re-exporting index.
- `resources` is an optional array of host-bound requirements. Each requirement names a stable slot and declares kind, required status, read/write ceiling, and allowed operations. Never put a concrete resource id, path, handle, credential, or secret in the manifest.
- Source paths are relative, normalized, and contained in the draft. Never use
  absolute paths, `..`, symlinks, dynamic imports, or runtime `require`.

The draft is an authoritative npm project. Keep its `package.json`,
package-lock format 3, `vite.config.mjs`, source, and non-empty `build` script
coherent. Editing `package.json` through the file tools runs host-owned
`npm install` and updates `package-lock.json`; never hand-edit the lockfile.
The build must emit a bounded `dist/main.js` ES module plus any relative chunks
and supported static assets. Do not write or import `dist/` as source.
Package lifecycle hooks and the build script execute with the build-server's
selected runner authority: the application host by default or an
operator-selected hardened Docker build runner. Keep them limited to necessary
compilation; never use them to inspect ambient credentials, host files, or
unrelated network services.

Validation captures one immutable source snapshot. The draft-private warm workspace runs
frozen `npm ci` when package or lock inputs change, then runs the
guest-owned `npm run build`; source-only edits reuse the installed workspace.
Omnidraw captures only the bounded regular-file `dist/` tree and gives those
exact bytes to Capsule for closed-distribution validation and artifact
construction. Capsule does not install dependencies or compile source.

A validated draft appears in the widget catalog sidebar next to its
publication. The user places an ephemeral Preview frame from the draft row or
from the Open Preview action on a successful create/validate result; placing
that frame builds the current draft bytes live and renders them. Publish is a
separate user action that rechecks the current draft digest, builds the exact
current source, and promotes that build; it never trusts a stored Preview
pointer.

Preview construction, diagnostics, handles, resource choices, and signing are
owned only by the current process and temporary files. They are not durable
revision authority. Preview collaborative/local state is authoring state and
does not become published-instance state. A user Publish action rechecks the
current draft digest and may reuse an exact compatible construction; it never
trusts a stored Preview pointer.
