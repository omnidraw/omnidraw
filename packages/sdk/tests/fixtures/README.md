# Retained Capsule artifact

`capsule-0.16-signed.json` contains an immutable, minimal signed artifact built
with the published `@omnidraw/capsule@0.16.0` public `buildCapsuleGuest` API and
signed with the public `signCapsuleArtifactBytes` API. Its source is recorded
in the fixture. It requests only DOM, has no channels or capabilities, and is
not parkable. The fixture's public key is test-only; the private key was discarded.

The closed external distribution contains `main.js`. Its producer is
`retained-fixture@1.0.0`; producer digest, source revision, dependency-lock
digest, and build-configuration digest are `sha256:` followed by 64 `a`s.
Build policy: 128 files/modules, 2 MiB per file, 8 MiB total/output,
256 path bytes, 16 path depth. Budgets use Capsule's defaults.

Do not regenerate this fixture with the current compiler or edit its bundle
digest to simulate an old artifact. Tests must exercise the exact signed old
bytes. No application data, production keys, or widget source is included.
