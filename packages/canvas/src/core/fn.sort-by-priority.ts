
export function fnSortByPriority<T extends { priority?: number; id: string }>(entries: T[]) {
  return [...entries].sort((left, right) => {
    const leftPriority = left.priority ?? 10_000;
    const rightPriority = right.priority ?? 10_000;
    if (leftPriority !== rightPriority) {
      return leftPriority - rightPriority;
    }

    return left.id.localeCompare(right.id);
  });
}
