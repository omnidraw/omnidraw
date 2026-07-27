import type {
  TCanvasSelectionMode,
  TCanvasTarget,
} from "../../semantic/typed";
import {
  fnCanvasTargetKey,
  fnUniqueCanvasTargets,
} from "../../semantic/fn.target";

export function fnApplyCanvasSelectionMode(
  current: readonly TCanvasTarget[],
  target: TCanvasTarget,
  mode: TCanvasSelectionMode,
) {
  const targetKey = fnCanvasTargetKey(target);
  const containsTarget = current.some((candidate) => {
    return fnCanvasTargetKey(candidate) === targetKey;
  });

  if (mode === "replace") {
    return [target];
  }

  if (mode === "add") {
    return containsTarget ? [...current] : [...current, target];
  }

  if (mode === "remove") {
    return current.filter((candidate) => {
      return fnCanvasTargetKey(candidate) !== targetKey;
    });
  }

  return containsTarget
    ? current.filter((candidate) => {
        return fnCanvasTargetKey(candidate) !== targetKey;
      })
    : [...current, target];
}

export function fnPruneCanvasSelection(
  selection: readonly TCanvasTarget[],
  availableTargetKeys: ReadonlySet<string>,
) {
  return fnUniqueCanvasTargets(selection).filter((target) => {
    return availableTargetKeys.has(fnCanvasTargetKey(target));
  });
}
