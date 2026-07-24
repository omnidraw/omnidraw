import type {
  TCanvasDoc,
  TElement,
  TGroup,
} from "@vibecanvas/service-automerge/types/canvas-doc.types";
import type { TCanvasTarget } from "../../semantic/typed";

export type TResolvedCanvasTarget =
  | {
      target: Extract<TCanvasTarget, { kind: "element" }>;
      element: TElement;
      group: null;
    }
  | {
      target: Extract<TCanvasTarget, { kind: "group" }>;
      element: null;
      group: TGroup;
    };

type TArgsResolveCanvasTarget = {
  document: TCanvasDoc;
  target: TCanvasTarget;
};

type TArgsResolveCanvasSelection = {
  document: TCanvasDoc;
  selection: readonly TCanvasTarget[];
};

export function fnResolveCanvasTarget(
  args: TArgsResolveCanvasTarget,
): TResolvedCanvasTarget | null {
  if (args.target.kind === "element") {
    const element = args.document.elements[args.target.id];
    return element === undefined
      ? null
      : {
          target: { ...args.target },
          element,
          group: null,
        };
  }
  const group = args.document.groups[args.target.id];
  return group === undefined
    ? null
    : {
        target: { ...args.target },
        element: null,
        group,
      };
}

export function fnResolveCanvasSelection(
  args: TArgsResolveCanvasSelection,
): TResolvedCanvasTarget[] {
  return args.selection
    .map((target) => fnResolveCanvasTarget({
      document: args.document,
      target,
    }))
    .filter((target): target is TResolvedCanvasTarget => target !== null);
}
