# @omnidraw/service-db

Turso-backed persistence services and authoritative stores for Omnidraw.

This is a private, server-only workspace package for the Omnidraw OSS
monorepo. It is not an npm release package and must not be published.

It contains the database service and its one immutable filesystem-first
baseline migration. The 14 retained application tables cover canvases and
canvas items, widget-instance state, resource catalog/control records, key
values, media, chat metadata, and the migration ledger. Widget source,
artifacts, drafts, preview processes, and function execution state live outside
this database.

The package is deliberately single-user. Repository methods use direct stable
IDs and database-generated UTC whole-second timestamps; there is no account,
membership, or organization scope in the schema or store surface.

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
