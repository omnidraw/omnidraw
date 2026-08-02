# @omnidraw/service-db

Turso-backed persistence services and authoritative stores for Omnidraw.

This is a private, server-only workspace package for the Omnidraw OSS
monorepo. It is not an npm release package and must not be published.

It contains the database service, schema migrations, canvas-item persistence,
widget and function control stores, resource control, and widget-instance state
persistence. Every customer-data operation is fenced by an injected tenant
context.

## Workspace use

```sh
bun run --cwd packages/service-db typecheck
bun run --cwd packages/service-db test
```

Other OSS workspaces may import its source subpaths through Bun's workspace
resolution:

```ts
import { DbServiceTurso } from '@omnidraw/service-db/DbServiceTurso/DbServiceTurso'
```

External consumers must use public contracts or API boundaries instead of
importing this internal service package.
