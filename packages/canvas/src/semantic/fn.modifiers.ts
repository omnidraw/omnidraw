import type { TCanvasModifierState } from "./typed";

export type TModifierSource = {
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
};

export function fnCanvasModifierState(
  source: TModifierSource,
): TCanvasModifierState {
  return {
    alt: source.altKey,
    control: source.ctrlKey,
    meta: source.metaKey,
    shift: source.shiftKey,
  };
}
