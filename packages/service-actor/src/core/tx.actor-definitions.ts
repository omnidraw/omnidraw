import type { DbServiceTurso } from "packages/service-db/src/DbServiceTurso/DbServiceTurso";
import type { TVibecanvasJson } from "./types";

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
      id: portal.crypto.randomUUID(),
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
