import type { TActorData } from "./types";

export function fnToActorData(value: unknown): TActorData | undefined {
  if(typeof value === 'string') {
    try {
      return fnToActorDataValue(JSON.parse(value))
    } catch {
      return undefined
    }
  }

  return fnToActorDataValue(value)
}

function fnToActorDataValue(value: unknown): TActorData | undefined {
  if(value === null) return null
  if(typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  if(Array.isArray(value)) {
    const items = value.map(fnToActorDataValue)
    if(items.some(item => item === undefined)) return undefined

    return items as TActorData[]
  }
  if(typeof value !== 'object') return undefined

  const record: Record<string, TActorData> = {}
  for(const [key, item] of Object.entries(value)) {
    const actorData = fnToActorDataValue(item)
    if(actorData !== undefined) record[key] = actorData
  }

  return record
}
