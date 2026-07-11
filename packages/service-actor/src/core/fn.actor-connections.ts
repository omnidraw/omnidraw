import type { TActorConnection } from "@vibecanvas/service-db/model";

export function fnIsActorConnectionEnabled(connection: TActorConnection): boolean {
  return connection.enabled
}

export function fnCanRouteActorConnectionMessage(connection: TActorConnection, msgName: string): boolean {
  const whitelist = connection.msg_name_whitelist
  if(!whitelist) return true

  try {
    const parsed = JSON.parse(whitelist)
    if(!Array.isArray(parsed)) return false

    return parsed.includes(msgName)
  } catch {
    return false
  }
}
