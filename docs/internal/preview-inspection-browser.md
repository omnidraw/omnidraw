# Preview inspection browser runtime

Status: the workspace runner, source-checkout signed-fixture acceptance, and an
acceptance-only packaged CLI qualification are implemented. `darwin-arm64` is
the sole A117-qualified compiled target. Its smoke executes the actual staged
Omnidraw binary, verifies the binary and selected public-only signed fixture
against the release manifest, performs one native action through the real
runner, and independently verifies the returned widget PNG. Every other
compiled target fails closed. This OSS repository still ships from source and
does not reinstate a general compiled application release pipeline.

## Runtime pin and installation

Preview inspection uses `playwright@1.61.1`, managed Chromium revision `1228`,
Chrome for Testing `149.0.7827.55`. All three values are exact runtime pins. The
npm pin lives in the root catalog and lockfile; the browser revision and version
live beside the runner limits. The launcher explicitly passes
`chromium.executablePath()` so Playwright cannot silently select its different
`chromium-headless-shell` executable in headless mode.

Prepare a source checkout with:

```sh
bun install
bun --cwd apps/cli x playwright@1.61.1 install chromium
bun run --cwd apps/preview-inspection-shell build
```

Linux CI or machine provisioning may append `--with-deps` before `chromium`
when it is authorized to install OS packages. The application never silently
installs browsers or system packages while handling a user request.

Before accepting work, the CLI preflight checks:

1. the version imported from the installed `playwright/package.json` is exactly
   `1.61.1`;
2. the managed executable path contains revision `1228` and is a regular file;
3. running that exact executable with `--version` reports
   `149.0.7827.55`;
4. SHA-256 is computed over that exact executable, not over a configured
   constant;
5. compiled builds have a valid same-target release manifest and the browser
   executable checksum matches; source builds may omit the release manifest;
6. every staged shell file matches its bounded size and SHA-256 manifest, with
   no symlink or traversal path;
7. the exact executable launches and reports the same browser version;
8. the task-owned temporary root can be recreated with owner-only permissions.

The runner never falls back to system Chrome or another installed browser. The
Playwright download service does not provide an archive checksum that this
repository can pin without fetching every platform archive. Instead, each
target release builder records the independently observed extracted executable
SHA-256 in the staged release manifest. Runtime preflight verifies that checksum
and launches the exact same path. This gives compiled releases deterministic
post-provision identity without making user jobs perform a download.

The acceptance-only packaged smoke additionally hashes `process.execPath` and
the selected signed fixture and requires exact manifest matches before browser
discovery. Acceptance-only Ed25519 seeds are fixed, public test material so
independent fixture generations are byte-comparable; production signing keys
are never used. The staged fixture contains public verification keys only; no
signing secret, host path, token, or arbitrary fixture path is staged.

## Acceptance-only packaged staging

The current application is source-distributed. A117 therefore uses an explicit
acceptance-only package rather than adding a product release pipeline. The
required native qualification gate creates and cleans a fresh candidate:

```sh
bun run test:preview-inspection-packaged
```

The portable package/preflight suite invokes that gate automatically on its
supported host and explicitly skips it elsewhere:

```sh
bun run test:preview-inspection-package
```

The lower-level commands remain available for inspecting a retained candidate:

```sh
bun run package:preview-inspection-runtime \
  --release-root /absolute/path/to/acceptance-release
bun run smoke:preview-inspection-runtime \
  --release-root /absolute/path/to/acceptance-release
```

The release root must be an existing, empty, non-symlinked directory before
packaging. Packaging is accepted only on macOS arm64. The packager regenerates the
existing signed browser fixture, builds the existing inspection shell, compiles
the real `apps/cli/src/main.ts` entrypoint with a compile-time marker, and then
stages the selected fixture and identity evidence. It uses the one required
Playwright bundler exclusion, `chromium-bidi/*`; the qualified Chromium path
does not load that optional BiDi mapper. Staging verifies the actual Playwright
package, revision, browser version, application/browser executable hashes, and
bounded fixture; rejects stale destinations; and writes:

```text
<release>/share/omnidraw/preview-inspection/
  runtime-manifest.json
  shell/index.html
  shell/assets/...
  qualification/signed-fixture.json
  licenses/playwright/...
  licenses/playwright-core/...
```

The package also contains `<release>/bin/omnidraw`. The internal smoke switch is
compile-marker gated and is unavailable from a source invocation. It accepts no
fixture or output path. Its success DTO is bounded JSON without paths, tokens,
or base64; the PNG is written to one fixed qualification path, independently
verified by the outer smoke, and removed before the command returns.

The compiled CLI resolves this directory relative to its own executable at
`../share/omnidraw/preview-inspection`; no environment override or build-host
path is accepted. The manifest contains only target, pin, checksum, bounded
shell file evidence, and a deterministic provisioning command. It never stores
the build host's executable path. The staged shell is capped at 256 files and
32 MiB and includes Playwright's Apache-2.0 license, notice, and third-party
notices.

## Isolation and lifecycle

The browser is process-owned and headless. A healthy process may be reused, but
every job receives a fresh Playwright browser context and page with no inherited
profile. Contexts deny permissions and downloads, block service workers, use a
fixed locale and timezone, and receive only the declared viewport, DPR, and
color scheme.

The launcher keeps Chromium's process sandbox enabled and opts the pinned full
Chrome for Testing build into ANGLE's SwiftShader backend with the exact
`--use-angle=swiftshader` and `--enable-unsafe-swiftshader` flags. Full
headless Chrome otherwise exposes no WebGL context on the qualified macOS arm64
host. This is an explicit software-rendering compatibility choice; it does not
reuse a profile, grant browser permissions, enable network access, or disable
the Chromium process sandbox. Both WebGL and WebGL2 context creation are covered
by the pinned-runtime qualification; higher-level rendering remains constrained
by the artifact's declared Capsule API group.

The inspection shell binds to `127.0.0.1` on an ephemeral port. Each job gets a
one-job 192-bit capability token. The URL contains only that tokenized static
path: job identity, artifact bytes, host paths, and function data never enter
URL/history. Static responses are no-store and carry a
restrictive CSP plus COOP, no-referrer, and no-sniff headers. Requests are
limited to that tokenized shell origin until mount; guest requests are aborted
after mount. Popups are closed and dialogs are dismissed. Browser extensions,
sync, component updates, background networking, first-run behavior, and service
autorun are disabled at launch.

The port bounds artifact and screenshot bytes, viewport and DPR, action count,
selector/input sizes, retained diagnostics, queue length, global concurrency,
one active job per owner, startup time, frame settlement, and whole-job time.
After the native pointer step, input revalidates the exact focused, editable,
non-sensitive target. Backspace, each non-empty text insertion, and Enter then
run under a one-shot Capsule-owned keyboard guard. The DOM membrane observes
the original trusted event, focus, and composed Selection before and after the
synchronous guest callback, so it can prevent that same native default when a
guest redirects focus or Selection even after calling
`stopImmediatePropagation`. Contenteditable input fails closed if exact
composed Selection endpoints are unavailable. Guard tickets/results are
generation and target scoped, strictly validated by the runner, and cleared on
finish, cancellation, unbind, disposal, or crash.

The runner closes the page and context, destroys the Capsule inspection handle,
releases the one-time shell lease, disposes the function bridge, and removes the
job directory in `finally` paths. It retires the shared browser after a page or
protocol crash or failed cleanup.

The implementation currently relies on Playwright's normal `launch()` profile
isolation rather than supplying an Omnidraw-owned persistent `userDataDir`.
There is no remote-debugging endpoint exposed by the service. The temporary
downloads directory is service-owned and removed on service stop; every job's
own temporary directory is removed in its bounded cleanup path.

## Qualified platform and architecture matrix

The package and smoke commands accept only the matrix below. OS versions outside
Playwright 1.61.1's support policy remain unsupported even when the CPU matches.

| Target key | Provisioning/staging gate | Evidence in this change |
| --- | --- | --- |
| `darwin-arm64` | Package and run the signed action/PNG smoke on macOS arm64 | Qualified twice from fresh release roots: actual compiled CLI, self/browser/fixture hashes, signed mount, native Increment click, and strict 640×480 PNG byte/structure/dimension/SHA-256 checks passed |
| `darwin-x64`, `linux-x64`, `linux-arm64`, `win32-x64`, or any other key | Rejected by packaging and compiled manifest resolution | Unsupported until that exact target is natively packaged and passes the same smoke |

The packaged smoke validates the staged shell hashes, application and
target-specific browser checksums, actual browser launch/version, tokenized
loopback serving, fresh isolated context, signed fixture mount through the real
runner, one native `Increment` click, resulting `click:1` evidence, and one
strictly valid 640×480 widget PNG. The outer verifier independently checks PNG
chunk framing, CRCs, IDAT/IEND termination, bounded zlib/DEFLATE decoding,
scanline/filter and indexed-palette validity, dimensions, byte size, and
SHA-256.

## Package size and licenses

Chromium is intentionally not hidden inside the CLI size. On the current macOS
arm64 development machine, the extracted Playwright cache measured about
344 MiB for full Chromium, 192 MiB for Chromium Headless Shell, and 2.5 MiB for
FFmpeg. These are local extracted measurements, not download sizes, release
budgets, or stable cross-platform values.

The staging manifest records browser identity/checksum and exact shell size.
Every release candidate must additionally record, per target:

- compressed browser download size;
- installed browser size and total application-size delta;
- exact Playwright version, browser revision/version, and artifact checksum;
- the chosen warning or rejection threshold for unexpected size growth.

Playwright and Playwright Core are Apache-2.0 and include a Microsoft `NOTICE`
with Puppeteer attribution. The Chromium distribution carries its own license
and third-party notices. A release that downloads or bundles the browser must
ship or expose all required notices and review them when the revision changes.
Removing notices to reduce package size is not allowed.

## Update policy

Treat Playwright and Chromium as one reviewed runtime change:

1. update the exact Playwright catalog pin and regenerate `bun.lock`;
2. record the new Chromium revision/version and per-platform checksums;
3. review upstream release notes, browser security advisories, license/notice
   changes, and package-size deltas;
4. run the pure port/PNG tests, shell build and typecheck, Capsule browser
   acceptance, isolation and failure tests, and the qualified packaged smoke;
5. stage a fresh darwin-arm64 manifest and run the packaged smoke in the same
   change; adding another target requires its own native qualification first.

Never accept browser revision drift, use a system-browser fallback, or update
only the Playwright npm package without requalifying its browser artifact.

## Stable failure codes

The service intentionally exposes bounded codes rather than Playwright objects,
CDP details, host paths, tokens, DOM nodes, or network traces. Guest runtime
locations survive only as bounded relative generated `.js`, `.mjs`, or `.cjs`
coordinates whose artifact hash and runtime/lifecycle generations match the
result. Absolute paths, URLs, traversal, raw messages, and mismatched locations
are rejected.

| Code | Meaning and operator action |
| --- | --- |
| `BROWSER_VERSION_MISMATCH` | Install the workspace lockfile with `bun install`, then restart. |
| `BROWSER_RUNTIME_UNAVAILABLE` | The pinned Playwright module could not resolve its runtime; reinstall workspace dependencies. |
| `BROWSER_EXECUTABLE_MISSING` | Run `bun --cwd apps/cli x playwright@1.61.1 install chromium`, then restart. |
| `BROWSER_RUNTIME_IDENTITY_INVALID` | The managed path, revision, executable version, or executable checksum could not be read; reprovision the exact pinned browser. |
| `BROWSER_RELEASE_MANIFEST_MISSING` | A compiled release is missing valid same-target runtime/shell evidence; rebuild with the staging command. |
| `BROWSER_CHECKSUM_MISMATCH` | The provisioned executable differs from the target release manifest; remove it and reprovision the pinned browser. |
| `INSPECTION_SHELL_MISSING` | Build `apps/preview-inspection-shell`, then restart. |
| `BROWSER_JOB_INVALID` | The caller supplied a malformed or out-of-bounds job. Correct the request. |
| `BROWSER_JOB_DUPLICATE` | A one-time job identifier was reused. Submit a new identifier. |
| `BROWSER_QUEUE_FULL` | The bounded queue is full. Retry after active work finishes. |
| `BROWSER_RUNNER_STOPPING` | Shutdown has begun. Retry after the service restarts. |
| `PREVIEW_INSPECTION_CANCELLED` | The caller or service cancelled the job. Retry only if still wanted. |
| `PREVIEW_INSPECTION_TIMED_OUT` | The whole-call deadline expired. Reduce work or retry after diagnosis. |
| `BROWSER_ARTIFACT_IDENTITY_MISMATCH` | Supplied bytes did not match their declared digest. Rebuild the exact artifact. |
| `BROWSER_PAGE_CRASHED` | The inspection page crashed; the process is retired before reuse. |
| `BROWSER_RESULT_INVALID` | Returned identity, generations, diagnostics, or bounds failed validation. |
| `SCREENSHOT_INVALID` | PNG signature, IHDR, or exact viewport/DPR dimensions were wrong. |
| `SCREENSHOT_TOO_LARGE` | The PNG exceeded the 8 MiB ceiling. |

Unexpected Playwright startup or protocol failures are normalized at the
runner boundary; callers must never expose raw Playwright messages, paths, or
tokens to agent or Chat surfaces.

## Distribution boundary

This repository intentionally removed its compiled binary distribution and
documents source operation only. The A117 package is an acceptance artifact,
not a restored product release pipeline. It qualifies darwin-arm64 and nothing
else. A future release builder must package and run the same signed action/PNG
smoke natively before adding any target to the supported matrix. No target may
infer support from another architecture's checksum or result.

The browser archive itself is not retained or redistributed by this repository.
The release manifest instead pins the extracted executable SHA-256 after exact
Playwright provisioning, and preflight both verifies and launches it. A future
offline installer that bundles the full browser directory must additionally
record the archive/tree checksum and Chromium license payload for that target.
