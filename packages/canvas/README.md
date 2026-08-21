# @omnidraw/canvas

`@omnidraw/canvas` is the public Solid host for the Omnidraw canvas kernel. It
composes Cangine rendering with the protocol-neutral document transport from
`@omnidraw/canvas-contract`; it does not include an API client, database,
server, tenant policy, or product sidebar.

## Install and compose

Install one compatible Solid core/web renderer pair together with the three
public kernel packages, then import the package stylesheet once in the host
bundle:

```ts
import '@omnidraw/canvas/styles.css';
import { Canvas, type TCanvasDependencies } from '@omnidraw/canvas';
import { ThemeService } from '@omnidraw/theme';
```

Render `Canvas` with a descriptor containing only `id`, an opaque stable host
scope key, and a readonly dependency bundle. The bundle supplies document,
theme, image, notification, ID, cancelable wait, diagnostics, runtime
extension, and optional toolbar behavior. Changing the scope key or canvas ID
serially disposes the previous runtime before the replacement starts.

Tenant-aware hosts can also provide the optional `hostRetirement` port.
Canvas registers its idempotent async disposal with that port so the host can
await complete shutdown before disconnecting tenant-scoped services.

Document transports implement snapshot, paged query, command, and event-stream
operations. They must close their underlying subscription promptly when the
consumer calls `AsyncIterator.return()`. Canvas extensions receive only the
Effect-free, renderer-neutral document, widget, shell, trace, DOM,
notification, and external-placement ports; Cangine never crosses that public
boundary. The placement port supplies client-to-world projection, visible
world bounds, viewport center, and an owner-scoped transient widget preview so
an application sidebar can implement full pointer gestures without importing a
renderer.

Package fonts and CSS assets are emitted below `dist/`; hosts do not need to
copy files to `/fonts` or expose another workspace's source tree.

Semantic authored paint is stored with a concrete old-client fallback. The
runtime keeps that authored node image separate from its theme-projected
Cangine node, so a viewer theme switch changes only the projected scene
revision and never the durable canvas revision. Literal paint remains stable.
Cangine 0.7.0 receives only resolved concrete values. Mounted selection and
path affordances update through its live appearance setters. Standard creation
uses its guarded all-tool decorator, while compact-picker edits pass semantic
intent to its extension-only selection mutation decorator. Cangine still plans
the compatible targets and sends one finalized batch unchanged to
`CanvasDocumentService`.

The `0.11.0` line uses `@omnidraw/canvas-contract@0.7.0`, the public
`@omnidraw/theme`, exact `effect@4.0.0-rc.108` internally, and exact
`@omnidraw/cangine@0.7.0`. The host provides one exact
`solid-js@2.0.0-rc.0` and `@solidjs/web@2.0.0-rc.0` pair; neither Effect nor
Cangine appears in Canvas public types.

See [ARCHITECTURE.md](./ARCHITECTURE.md) in the source repository for runtime
ownership and lifecycle details.
