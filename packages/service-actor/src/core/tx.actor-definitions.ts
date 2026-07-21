import type { TTenantDb } from "@vibecanvas/service-db/DbServiceTurso/DbServiceTurso";
import type { TVibecanvasJson } from "./types";
import type { readdir as _readdir } from 'node:fs/promises';
import type { rm as _rm } from 'node:fs/promises';
import type { dirname as _dirname } from 'node:path';
import type { isAbsolute as _isAbsolute, join as _join, relative as _relative } from 'node:path';

type TVibecanvasDefinition = TVibecanvasJson & {
  readonly manifest_path: string,
  readonly url?: string,
}

type TPortalSyncDbActorDefinitions = {
  db: TTenantDb,
  crypto: Pick<typeof crypto, "randomUUID">,
  configPath: string,
  isAbsolute: typeof _isAbsolute,
  relative: typeof _relative,
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

type TPortalDeleteActorDefinitionFiles = {
  dirname: typeof _dirname,
  rm: typeof _rm,
}

type TArgsDeleteActorDefinitionFiles = {
  absManifestPath: string,
}

function manifestPathToRelativeConfigPath(portal: TPortalSyncDbActorDefinitions, manifestPath: string): string {
  return portal.isAbsolute(manifestPath) ? portal.relative(portal.configPath, manifestPath) : manifestPath
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

export async function txDeleteActorDefinitionFiles(portal: TPortalDeleteActorDefinitionFiles, args: TArgsDeleteActorDefinitionFiles): Promise<void> {
  await portal.rm(portal.dirname(args.absManifestPath), {
    recursive: true,
    force: true,
  })
}

export async function txSyncDbActorDefinitions(portal: TPortalSyncDbActorDefinitions, args: TArgsSyncDbActorDefinitions) {
  const definitionsInDb = await portal.db.actor.listDefinitions()
  const definitionsByManifestPath = new Map(definitionsInDb.map(definition => [
    manifestPathToRelativeConfigPath(portal, definition.manifest_path),
    definition,
  ]))
  const definitionsBySlug = new Map(definitionsInDb.map(definition => [definition.slug, definition]))
  const definitionsByName = new Map(definitionsInDb.map(definition => [definition.name, definition]))
  const defsWithRelativeManifestPath = args.defs.map(definition => ({
    ...definition,
    manifest_path: manifestPathToRelativeConfigPath(portal, definition.manifest_path),
  }))
  const promises: Promise<unknown>[] = []

  defsWithRelativeManifestPath.forEach(def => {
    const existingDefinition = definitionsByManifestPath.get(def.manifest_path)
      ?? definitionsBySlug.get(def.slug)
      ?? definitionsByName.get(def.name)

    if (existingDefinition) {
      promises.push(portal.db.actor.updateDefinition({
        currentSlug: existingDefinition.slug,
        manifest_path: def.manifest_path,
        name: def.name,
        slug: def.slug,
        description: def.description ?? null,
        url: def.url ?? null,
      }))
      return
    }

    const p = portal.db.actor.insertDefinition({
      description: def.description ?? null,
      manifest_path: def.manifest_path,
      name: def.name,
      slug: def.slug,
      url: def.url ?? null,
    })
    promises.push(p)
  })

  const results = await Promise.allSettled(promises)
  return results.flatMap((result) => result.status === 'rejected' ? [result.reason as unknown] : [])
}
