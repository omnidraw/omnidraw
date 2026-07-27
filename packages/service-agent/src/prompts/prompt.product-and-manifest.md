# Vibecanvas manifest v3

Build browser-first widgets. `vibecanvas.json` is the authoritative manifest
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
    "target": {
      "runtimeAbi": "quickjs-release-sync-v1",
      "domProfile": "dom-core-v2",
      "featureProfiles": ["artifact-resources-v1"]
    }
  }
}
```

- `name` is the human-readable identity and must match the draft identity.
- `slug` is lowercase kebab-case and remains stable after publication.
- `ui.runtime` is always `capsule`; `ui.entry` is one safe relative TypeScript
  or JavaScript entry path.
- `ui.target` requests the runtime and browser compatibility profiles needed by
  the source. Keep feature profiles minimal and sorted. The host may reduce or
  reject a request; it never becomes authority by appearing in the manifest.
- `ui.budgets` may request non-negative Capsule ceilings for `cpuMs`,
  `memoryBytes`, `domNodes`, `handles`, `messageBytes`, `streamBytes`,
  `assetBytes`, `networkBytes`, `gpuBytes`, and `lifecycleBytes`. Omit it to use
  product defaults. Zero explicitly denies that dimension.
- Add `ui.state` only when needed. `collaborative` declares shared
  widget-instance state; `localStore` is `none` or `ephemeral`.
- Parking is unavailable in this release. Do not request it.
- Omit `server` and `resources` for a UI-only widget. This is the default.
- Add `server: { "entry": "server/main.server.ts", "runtimeAbi": "vibecanvas-function-v1" }` only when the request truly needs a short server function. The entry module itself must contain the direct named function exports; do not create a re-exporting index.
- `resources` is an optional array of host-bound requirements. Each requirement names a stable slot and declares kind, required status, read/write ceiling, and allowed operations. Never put a concrete resource id, path, handle, credential, or secret in the manifest.
- Source paths are relative, normalized, and contained in the draft. Never use
  absolute paths, `..`, symlinks, dynamic imports, or runtime `require`.

The draft is an authoritative npm project. Keep its `package.json`,
package-lock format 3, `vite.config.mjs`, source, and non-empty `build` script
coherent. Editing `package.json` through the file tools runs host-owned
`npm install` and updates `package-lock.json`; never hand-edit the lockfile.
The build must emit a bounded `dist/main.js` ES module plus any relative chunks
and supported static assets. Do not write or import `dist/` as source.
Package lifecycle hooks and the build script execute with the build-server
account during this testing phase. Keep them limited to necessary compilation;
never use them to inspect ambient credentials, host files, or unrelated
network services.

Validation, Preview, and publication pin one immutable source snapshot, run
frozen `npm ci`, then run the guest-owned `npm run build`. Vibecanvas captures
only the bounded regular-file `dist/` tree and gives those exact bytes to
Capsule for closed-distribution validation and artifact construction. Capsule
does not install dependencies or compile source. The resulting UI artifact and
optional server artifact are signed and bound into one contract. Draft Preview
uses this same path with a preview signature, ephemeral collaborative state, no
real server-function authority, and no durable local-store restore. “Ready”
never means published.
