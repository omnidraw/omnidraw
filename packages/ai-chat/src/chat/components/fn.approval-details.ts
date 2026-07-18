const REDACTED_DETAIL_KEY = /(secret|password|token|credential|api[-_]?key|value)/i
const MAX_DETAIL_DEPTH = 6
const MAX_DETAIL_ITEMS = 100

export function fnRedactApprovalDetails(details: unknown, depth = 0): unknown {
  if (depth >= MAX_DETAIL_DEPTH) return "[detail depth limited]"
  if (Array.isArray(details)) {
    return details.slice(0, MAX_DETAIL_ITEMS).map((value) => fnRedactApprovalDetails(value, depth + 1))
  }
  if (!details || typeof details !== "object") return details

  return Object.fromEntries(
    Object.entries(details as Record<string, unknown>)
      .slice(0, MAX_DETAIL_ITEMS)
      .map(([key, value]) => [
        key,
        REDACTED_DETAIL_KEY.test(key) ? "[redacted]" : fnRedactApprovalDetails(value, depth + 1),
      ]),
  )
}
