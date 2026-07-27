import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import type {
  TThemeRememberedStyle,
  TThemeStyleScopeId,
} from "@vibecanvas/service-theme";
import type { TSelectionStyleProperty } from "../../core/fn.selection-style-menu";

export type TSelectionStyleRememberedUpdate = {
  scope: TThemeStyleScopeId;
  patch: Partial<TThemeRememberedStyle>;
};

export type TArgsGetSelectionStyleRememberedUpdates = {
  activeToolId: string | null;
  elements: readonly TElement[];
  property: TSelectionStyleProperty;
  value: string | number;
};

function isRememberedStyleScope(
  scope: string,
): scope is TThemeStyleScopeId {
  return scope === "rect"
    || scope === "diamond"
    || scope === "ellipse"
    || scope === "line"
    || scope === "arrow"
    || scope === "pen"
    || scope === "text"
    || scope === "image";
}

function rememberedStyleKey(
  property: TSelectionStyleProperty,
  scope: TThemeStyleScopeId,
): keyof TThemeRememberedStyle {
  if (property === "fill") {
    return scope === "pen" ? "strokeColor" : "fillColor";
  }
  if (property === "stroke") {
    return "strokeColor";
  }
  return property;
}

function createUpdate(
  scope: TThemeStyleScopeId,
  property: TSelectionStyleProperty,
  value: string | number,
): TSelectionStyleRememberedUpdate {
  return {
    scope,
    patch: {
      [rememberedStyleKey(property, scope)]: value,
    },
  };
}

export function fnGetSelectionStyleRememberedUpdates(
  args: TArgsGetSelectionStyleRememberedUpdates,
): TSelectionStyleRememberedUpdate[] {
  const updates = new Map<
    TThemeStyleScopeId,
    TSelectionStyleRememberedUpdate
  >();

  for (const element of args.elements) {
    const scope = element.data.type;
    if (!isRememberedStyleScope(scope) || updates.has(scope)) {
      continue;
    }
    updates.set(
      scope,
      createUpdate(scope, args.property, args.value),
    );
  }

  if (
    args.activeToolId !== null
    && isRememberedStyleScope(args.activeToolId)
    && !updates.has(args.activeToolId)
  ) {
    updates.set(
      args.activeToolId,
      createUpdate(args.activeToolId, args.property, args.value),
    );
  }

  return [...updates.values()];
}
