# @omnidraw/canvas

`@omnidraw/canvas` is the public Solid host for the Omnidraw canvas kernel. It
composes Cangine rendering with the protocol-neutral document transport from
`@omnidraw/canvas-contract`; it does not include an API client, database,
server, tenant policy, or product sidebar.

## Install and compose

Install one compatible Solid runtime together with the three public kernel
packages, then import the package stylesheet once in the host bundle:

```ts
import '@omnidraw/canvas/styles.css';
import { Canvas, type TCanvasDependencies } from '@omnidraw/canvas';
import { ThemeService } from '@omnidraw/service-theme';
```

Render `Canvas` with a descriptor containing only `id`, an opaque stable host
scope key, and a readonly dependency bundle. The bundle supplies document,
theme, image, notification, ID, cancelable wait, diagnostics, runtime
extension, and optional toolbar behavior. Changing the scope key or canvas ID
serially disposes the previous runtime before the replacement starts.

Tenant-aware hosts can also provide the optional `runtimeRetirement` port.
Canvas registers its idempotent async runtime disposal with that port so the
host can await complete shutdown before disconnecting tenant-scoped services.

Document transports must close their underlying subscription promptly when
the consumer calls `AsyncIterator.return()`. Runtime extensions and toolbar
contributions are installed in host order and must dispose any resources they
own.

Package fonts and CSS assets are emitted below `dist/`; hosts do not need to
copy files to `/fonts` or expose another workspace's source tree.

The `0.5.0` release line uses `@omnidraw/canvas-contract@0.5.0`,
`@omnidraw/service-theme@0.5.0`, and `@omnidraw/cangine@0.5.3`. The host must
provide one `solid-js` runtime compatible with `^1.9.14`.

See [ARCHITECTURE.md](./ARCHITECTURE.md) in the source repository for runtime
ownership and lifecycle details.
