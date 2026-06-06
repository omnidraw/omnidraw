import type { Database } from "@tursodatabase/database"
import { DEFAULT_OSS_ACCOUNT_ID } from "../CONSTANTS"
import type { TAccount } from "../model"

type TPortal = {
  db: Database
}
type TArgs = {}

export async function fxAccountGetDefaultOwner(portal: TPortal, args: TArgs): Promise<TAccount | null> {
  const stmt = await portal.db.prepare(`SELECT * FROM accounts WHERE id = ?`)
  const row = await stmt.get(DEFAULT_OSS_ACCOUNT_ID)
  return row as TAccount | null
}
