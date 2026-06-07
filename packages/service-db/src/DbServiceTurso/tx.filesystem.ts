import type { Database } from "@tursodatabase/database"
import type { TFilesystem } from "../model"

type TPortal = {
  db: Database
}

type TArgsCreate = Pick<TFilesystem, "id" | "name">

export async function txFilesystemCreate(portal: TPortal, args: TArgsCreate): Promise<TFilesystem> {
  const stmt = await portal.db.prepare(`
    INSERT INTO file_systems (id, name, slug, path)
    VALUES (?, ?, ?, ?)
    RETURNING *
  `)
  const row = await stmt.get(args.id, args.name, args.name, "")

  if (!row) {
    throw new Error("Failed to create filesystem record")
  }

  return row as TFilesystem
}
