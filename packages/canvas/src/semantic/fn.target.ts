import type { TCanvasTarget } from "./typed";

export function fnCanvasTargetKey(target: TCanvasTarget) {
  return `${target.kind}:${target.id}`;
}

export function fnCanvasTargetsEqual(
  left: TCanvasTarget | null,
  right: TCanvasTarget | null,
) {
  return left === right
    || (
      left !== null
      && right !== null
      && left.kind === right.kind
      && left.id === right.id
    );
}

export function fnUniqueCanvasTargets(targets: readonly TCanvasTarget[]) {
  const seen = new Set<string>();

  return targets.filter((target) => {
    const key = fnCanvasTargetKey(target);
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

export function fnIsCanvasTarget(value: unknown): value is TCanvasTarget {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as {
    id?: unknown;
    kind?: unknown;
  };
  return (
    (candidate.kind === "element" || candidate.kind === "group")
    && typeof candidate.id === "string"
    && candidate.id.length > 0
  );
}
