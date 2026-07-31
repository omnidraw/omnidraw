# Omnidraw manifest v3

Build browser-first widgets. `omnidraw.json` is the authoritative manifest
and must use schema version 3:

```json
{
  "schemaVersion": 3,
  "name": "Timer",
  "slug": "timer",
  "description": "A focused timer",
  "ui": {
    "runtime": "capsule",
    "entry": "ui/main.ts",
    "apis": ["DOM"]
  }
}
```

- `name` is the human-readable identity and must match the draft identity.
- `slug` is lowercase kebab-case and remains stable after publication.
- `ui.runtime` is always `capsule`; `ui.entry` is one safe relative TypeScript
  or JavaScript entry path.
- `ui.apis` requests Capsule public API groups. `DOM` is explicit and mandatory.
  Add only the groups the source needs. `CANVAS_2D`, `WEBGL`, and `WEBGPU` are
  mutually exclusive.
- `ui.budgets` may request non-negative Capsule ceilings for `cpuMs`,
  `memoryBytes`, `domNodes`, `handles`, `messageBytes`, `streamBytes`,
  `assetBytes`, `networkBytes`, `gpuBytes`, and `lifecycleBytes`. Omit it to use
  Capsule's selected-group defaults. Zero explicitly denies that dimension.
- Do not call a widget Preview-ready unless validation retained a successful
  browser Preview execution result for that exact construction.
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

Validation and an open Preview pin one immutable source snapshot and share its
content-addressed construction. The draft-private warm workspace runs
frozen `npm ci` when package or lock inputs change, then runs the
guest-owned `npm run build`; source-only edits reuse the installed workspace.
Omnidraw captures only the bounded regular-file `dist/` tree and gives those
exact bytes to Capsule for closed-distribution validation and artifact
construction. Capsule does not install dependencies or compile source.

The durable frame-owned Preview signs and retains that exact source/UI/server
construction. Its UI invokes the exact retained server artifact with the
user-selected resource binding revision. Preview collaborative/local state is
authoring state and does not become published-instance state. A user Publish
action release-signs and commits the retained construction without rerunning
npm, the project build, or Capsule construction. “Ready” never means published.
