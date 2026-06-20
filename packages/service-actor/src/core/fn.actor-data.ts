export function fnToActorData(value: unknown): Record<string, any> | undefined {
  if(typeof value === 'string') {
    try {
      return fnToActorData(JSON.parse(value))
    } catch {
      return undefined
    }
  }

  if(!value || typeof value !== 'object' || Array.isArray(value)) return undefined

  return value as Record<string, any>
}
