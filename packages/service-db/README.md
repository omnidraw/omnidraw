# @omnidraw/service-db

Turso-backed persistence services and authoritative stores for Omnidraw.

This server-only package contains the database service, schema migrations,
canvas-item persistence, widget and function control stores, resource control,
and widget-instance state persistence. Every customer-data operation is fenced
by an injected tenant context.

## Installation

```sh
npm install @omnidraw/service-db
```

The package targets Bun 1.3.14 or newer and uses Bun file/runtime APIs around
`@tursodatabase/database`. Browser and Node-only applications should consume
API contracts instead of importing this package directly.

Existing public subpaths are preserved, including:

```ts
import { DbServiceTurso } from '@omnidraw/service-db/DbServiceTurso/DbServiceTurso'
import { CanvasItemStoreTurso } from '@omnidraw/service-db/CanvasItemStoreTurso'
import { ZCanvas } from '@omnidraw/service-db/model'
```

## Package build

```sh
bun run build
npm publish ./dist
```

The generated `dist/` directory is the standalone npm package. It contains
compiled ESM, declarations, SQL migrations, exact public Omnidraw dependency
versions, and no workspace or catalog protocols.
