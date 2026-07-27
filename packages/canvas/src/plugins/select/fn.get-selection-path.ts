import type { TCanvasSemanticHit, TCanvasTarget } from "../../semantic/typed";
import {
  fnCanvasTargetKey,
  fnCanvasTargetsEqual,
  fnUniqueCanvasTargets,
} from "../../semantic/fn.target";

type TArgsGetSelectionPath = {
  hit: TCanvasSemanticHit;
};

type TArgsSelectionPathPrefix = {
  selection: readonly TCanvasTarget[];
  path: readonly TCanvasTarget[];
};

type TArgsGetMarqueeTargets = {
  hits: readonly TCanvasSemanticHit[];
};

export function fnGetSelectionPath(
  args: TArgsGetSelectionPath,
): TCanvasTarget[] {
  return fnUniqueCanvasTargets([
    ...args.hit.groupAncestry.map((id) => ({
      kind: "group" as const,
      id,
    })),
    args.hit.target,
  ]);
}

export function fnIsSelectionPathPrefix(
  args: TArgsSelectionPathPrefix,
): boolean {
  return args.selection.length <= args.path.length
    && args.selection.every((target, index) => {
      return fnCanvasTargetsEqual(target, args.path[index] ?? null);
    });
}

export function fnGetMarqueeTargets(
  args: TArgsGetMarqueeTargets,
): TCanvasTarget[] {
  const targets = fnUniqueCanvasTargets(args.hits.map((hit) => {
    const topGroupId = hit.groupAncestry[0];
    return topGroupId === undefined
      ? hit.target
      : {
          kind: "group" as const,
          id: topGroupId,
        };
  }));
  return targets.sort((left, right) => {
    return fnCanvasTargetKey(left).localeCompare(fnCanvasTargetKey(right));
  });
}
