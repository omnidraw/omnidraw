import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import type {
  CrdtService,
  ElementService,
  HistoryService,
  SceneService,
  SelectionService
} from "../services";
import { fnResolveSelectionStyleTextElements } from "./fn.resolve-selection-style-text-elements";
import {
  fnGetSelectionStyleStrokeColorKey,
  fnHasSelectionStylePropertySupport,
  type TSelectionStyleProperty,
} from "./fn.selection-style-menu";
import { fxResolveSelectionStyleElements } from "./fx.resolve-selection-style-elements";
import {
  fxCloneElementWithSelectionStyle,
  fxCreateSelectionStyleDataPatch,
} from "./fx.selection-style-element-patch";

export type TPortalApplySelectionStyleChange = {
  crdt: CrdtService;
  element: ElementService;
  history: HistoryService;
  scene: SceneService;
  selection: SelectionService;
  txRefreshEditingShape1d: () => void;
  now: () => number;
};

export type TArgsApplySelectionStyleChange = {
  property: TSelectionStyleProperty;
  value: string | number;
};

export type TSelectionStyleChangePlan = {
  beforeById: Map<string, TElement>;
  afterElements: TElement[];
};

export type TArgsCreateSelectionStyleChangePlan = TArgsApplySelectionStyleChange;
export type TArgsApplySelectionStyleChangeRuntime = {
  plan: TSelectionStyleChangePlan;
};
export type TArgsCommitSelectionStyleChange = {
  property: TSelectionStyleProperty;
  plan: TSelectionStyleChangePlan;
};

function fnApplyElements(element: ElementService, elements: TElement[]) {
  elements.forEach((el) => {
    element.updateElement(el);
  });
}

function fnIsTextStyleProperty(property: TSelectionStyleProperty) {
  return property === "fontFamily"
    || property === "fontSize"
    || property === "textAlign"
    || property === "verticalAlign";
}

function fnIsDataStyleProperty(property: TSelectionStyleProperty): property is Extract<
  TSelectionStyleProperty,
  "fontFamily" | "fontSize" | "lineType" | "startCap" | "endCap"
> {
  return property === "fontFamily"
    || property === "fontSize"
    || property === "lineType"
    || property === "startCap"
    || property === "endCap";
}

export function txCreateSelectionStyleChangePlan(
  portal: TPortalApplySelectionStyleChange,
  args: TArgsCreateSelectionStyleChangePlan,
): TSelectionStyleChangePlan | null {
  const resolvedElements = fxResolveSelectionStyleElements({
    element: portal.element,
    scene: portal.scene,
    selection: portal.selection,
  });
  const targetElements = fnIsTextStyleProperty(args.property)
    ? fnResolveSelectionStyleTextElements( {
      elements: resolvedElements,
    })
    : resolvedElements;
  const beforeElements = targetElements.map((element) => structuredClone(element));
  const afterElements = targetElements.flatMap((element) => {
    const config = portal.element.getSelectionStyleMenuConfigByElement({ element });
    if (!fnHasSelectionStylePropertySupport({ config, property: args.property })) {
      return [];
    }

    if (args.property === "fill" && typeof args.value === "string") {
      return [fxCloneElementWithSelectionStyle({ now: portal.now }, { element, style: { backgroundColor: args.value } })];
    }

    if (args.property === "stroke" && typeof args.value === "string") {
      if (element.data.type === "pen" || element.data.type === "line" || element.data.type === "arrow") {
        const colorKey = fnGetSelectionStyleStrokeColorKey(element);
        return [fxCloneElementWithSelectionStyle({ now: portal.now }, { element, style: { [colorKey]: args.value } })];
      }

      return [fxCloneElementWithSelectionStyle({ now: portal.now }, { element, style: { strokeColor: args.value } })];
    }

    if (args.property === "strokeWidth" && typeof args.value === "string") {
      return [fxCloneElementWithSelectionStyle({ now: portal.now }, { element, style: { strokeWidth: args.value } })];
    }

    if (args.property === "opacity" && typeof args.value === "number") {
      return [fxCloneElementWithSelectionStyle({ now: portal.now }, { element, style: { opacity: args.value } })];
    }

    if (args.property === "textAlign" && typeof args.value === "string") {
      return [fxCloneElementWithSelectionStyle({ now: portal.now }, {
        element,
        style: { textAlign: args.value as "left" | "center" | "right" },
      })];
    }

    if (args.property === "verticalAlign" && typeof args.value === "string") {
      return [fxCloneElementWithSelectionStyle({ now: portal.now }, {
        element,
        style: { verticalAlign: args.value as "top" | "middle" | "bottom" },
      })];
    }

    if (typeof args.value === "string" && fnIsDataStyleProperty(args.property)) {
      const patch = fxCreateSelectionStyleDataPatch({ now: portal.now }, { element, property: args.property, value: args.value });
      return patch ? [patch] : [];
    }

    return [];
  });

  const dedupedAfterElements = [...new Map(afterElements.map((element) => [element.id, element])).values()];
  if (dedupedAfterElements.length === 0) {
    return null;
  }

  const beforeById = new Map(beforeElements.map((element) => [element.id, element]));

  return {
    beforeById,
    afterElements: dedupedAfterElements,
  };
}

export function txApplySelectionStyleChangeRuntime(
  portal: TPortalApplySelectionStyleChange,
  args: TArgsApplySelectionStyleChangeRuntime,
) {
  fnApplyElements(portal.element, args.plan.afterElements);
  portal.txRefreshEditingShape1d();
}

export function txCommitSelectionStyleChange(
  portal: TPortalApplySelectionStyleChange,
  args: TArgsCommitSelectionStyleChange,
) {
  const commitResult = (() => {
    const builder = portal.crdt.build();
    args.plan.afterElements.forEach((element) => {
      builder.patchElement(element.id, element);
    });
    return builder.commit();
  })();

  portal.history.record({
    label: `selection-style-${args.property}`,
    undo: () => {
      const revert = args.plan.afterElements
        .map((element) => args.plan.beforeById.get(element.id))
        .filter((element): element is TElement => Boolean(element));
      fnApplyElements(portal.element, revert);
      portal.txRefreshEditingShape1d();
      commitResult.rollback();
    },
    redo: () => {
      fnApplyElements(portal.element, args.plan.afterElements);
      portal.txRefreshEditingShape1d();
      portal.crdt.applyOps({ ops: commitResult.redoOps });
    },
  });
}

export function txApplySelectionStyleChange(
  portal: TPortalApplySelectionStyleChange,
  args: TArgsApplySelectionStyleChange,
) {
  const plan = txCreateSelectionStyleChangePlan(portal, args);
  if (!plan) {
    return null;
  }

  txApplySelectionStyleChangeRuntime(portal, { plan });
  txCommitSelectionStyleChange(portal, { property: args.property, plan });
  return plan;
}
