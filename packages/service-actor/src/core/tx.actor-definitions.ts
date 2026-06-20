import type { DbServiceTurso } from "@vibecanvas/service-db/DbServiceTurso/DbServiceTurso";
import type { TVibecanvasJson } from "./types";
import type { readdir as _readdir } from 'node:fs/promises';
import type { join as _join, relative as _relative } from 'node:path';

type TVibecanvasDefinition = TVibecanvasJson & {
  readonly manifest_path: string,
  readonly url?: string,
}

type TPortalSyncDbActorDefinitions = {
  db: DbServiceTurso,
  crypto: Pick<typeof crypto, "randomUUID">,
}

type TArgsSyncDbActorDefinitions = {
  defs: TVibecanvasDefinition[],
}

type TPortalReadWidgetCode = {
  Bun: Pick<typeof Bun, 'file'>,
  readdir: typeof _readdir,
  join: typeof _join,
  relative: typeof _relative,
}

type TArgsReadWidgetCode = {
  absWidgetDir: string,
}

export async function txGetWidgetCode(portal: TPortalReadWidgetCode, args: TArgsReadWidgetCode): Promise<{content: string, path: string}[]> {
  const collectFiles = async (dir: string): Promise<{content: string, path: string}[]> => {
    const items = await portal.readdir(dir, {withFileTypes: true})
    const groups = await Promise.all(items.map(async (item) => {
      const childPath = portal.join(dir, item.name)
      if (item.isDirectory()) {
        return collectFiles(childPath)
      }
      if (!item.isFile()) {
        return []
      }

      const content = await portal.Bun.file(childPath).text()
      const relPath = portal.relative(args.absWidgetDir, childPath)
      return [{content, path: relPath}]
    }))

    return groups.flat()
  }

  return collectFiles(args.absWidgetDir)
}

export async function txSyncDbActorDefinitions(portal: TPortalSyncDbActorDefinitions, args: TArgsSyncDbActorDefinitions) {
  const definitionsInDb = await portal.db.actor.listDefinitions()
  const defsToInsert: Set<TVibecanvasDefinition> = new Set()
  const defsToUpdate: Set<TVibecanvasDefinition> = new Set()
  const manifestPathsInDb = new Set(definitionsInDb.map(definition => definition.manifest_path))

  args.defs.forEach(def => {
    if(manifestPathsInDb.has(def.manifest_path))
      defsToUpdate.add(def)
    else defsToInsert.add(def)
  })

  const promises: Promise<any>[] = []

  defsToUpdate.forEach(def => {
    const p = portal.db.actor.updateDefinition({
      manifest_path: def.manifest_path,
      name: def.name,
      slug: def.slug,
      description: def.description ?? null,
      url: def.url ?? null,
    })
    promises.push(p)
  })

  defsToInsert.forEach(def => {
    const p = portal.db.actor.insertDefinition({
      description: def.description ?? null,
      manifest_path: def.manifest_path,
      name: def.name,
      slug: def.slug,
      url: def.url ?? null,
    })
    promises.push(p)
  })

  await Promise.all(promises)
}
