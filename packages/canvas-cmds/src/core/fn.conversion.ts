/* eslint-disable functional-core/export-shape -- legacy converter name is part of the command API */
export function toIsoString(value: Date | string | number): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'number') return new Date(value * 1000).toISOString();
  return new Date(value).toISOString();
}
