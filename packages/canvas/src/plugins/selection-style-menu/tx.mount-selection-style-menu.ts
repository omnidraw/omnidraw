import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import type { ThemeService } from "@vibecanvas/service-theme";
import type * as Solid from "solid-js";
import type * as SolidWeb from "solid-js/web";
import type { SelectionStyleMenu as TSelectionStyleMenu } from "../../components/SelectionStyleMenu";
import type {
  TCapStyle,
  TFontFamily,
  TLineType,
} from "../../components/SelectionStyleMenu/types";
import { fnResolveSelectionStyleTextElements } from "../../core/fn.resolve-selection-style-text-elements";
import {
  fnGetSelectionStyleMenuSections,
  fnGetSelectionStyleMenuValues,
  fnGetSelectionStyleStrokeColorKey,
  fnGetSelectionStyleStrokeWidthOptions,
  fnHasSelectionStylePropertySupport,
  type TSelectionStyleProperty,
} from "../../core/fn.selection-style-menu";
import {
  fxCloneElementWithSelectionStyle,
  fxCreateSelectionStyleDataPatch,
} from "../../core/fx.selection-style-element-patch";
import type {
  CrdtService,
  TCrdtCommitResult,
  ElementService,
  HistoryService,
  SceneService,
  SelectionService,
  SessionService,
  ToolService,
} from "../../services";
import { OPACITY_COMMIT_DEBOUNCE_MS } from "./CONSTANTS";
import { fnGetSelectionStyleRememberedUpdates } from "./fn.remembered-style";

type TSelectionStylePlan = {
  after: TElement[];
};

type TPendingOpacityCommit = {
  undoOps: TCrdtCommitResult["undoOps"];
  redoOps: TCrdtCommitResult["redoOps"];
};

export type TPortalMountSelectionStyleMenu = {
  SelectionStyleMenu: typeof TSelectionStyleMenu;
  createComponent: typeof Solid.createComponent;
  createMemo: typeof Solid.createMemo;
  createSignal: typeof Solid.createSignal;
  render: typeof SolidWeb.render;
  now(): number;
  setTimeout(handler: () => void, timeout: number): number;
  clearTimeout(timer: number): void;
  crdt: CrdtService;
  element: ElementService;
  history: HistoryService;
  scene: SceneService;
  selection: SelectionService;
  session: SessionService;
  theme: ThemeService;
  tool: ToolService;
};

export type TArgsMountSelectionStyleMenu = Record<string, never>;

function selectedElements(
  portal: TPortalMountSelectionStyleMenu,
): TElement[] {
  return portal.selection.resolveSelection(portal.crdt.doc())
    .flatMap((resolved) => {
      return resolved.element === null ? [] : [resolved.element];
    });
}

function isTextProperty(property: TSelectionStyleProperty): boolean {
  return property === "fontFamily"
    || property === "fontSize"
    || property === "textAlign"
    || property === "verticalAlign";
}

function patchElement(
  portal: TPortalMountSelectionStyleMenu,
  element: TElement,
  property: TSelectionStyleProperty,
  value: string | number,
): TElement | null {
  const now = () => portal.now();
  if (property === "fill" && typeof value === "string") {
    return fxCloneElementWithSelectionStyle(
      { now },
      { element, style: { backgroundColor: value } },
    );
  }
  if (property === "stroke" && typeof value === "string") {
    const key = fnGetSelectionStyleStrokeColorKey(element);
    return fxCloneElementWithSelectionStyle(
      { now },
      { element, style: { [key]: value } },
    );
  }
  if (property === "strokeWidth" && typeof value === "string") {
    return fxCloneElementWithSelectionStyle(
      { now },
      { element, style: { strokeWidth: value } },
    );
  }
  if (property === "opacity" && typeof value === "number") {
    return fxCloneElementWithSelectionStyle(
      { now },
      { element, style: { opacity: value } },
    );
  }
  if (property === "textAlign" && typeof value === "string") {
    return fxCloneElementWithSelectionStyle(
      { now },
      {
        element,
        style: {
          textAlign: value as "left" | "center" | "right",
        },
      },
    );
  }
  if (property === "verticalAlign" && typeof value === "string") {
    return fxCloneElementWithSelectionStyle(
      { now },
      {
        element,
        style: {
          verticalAlign: value as "top" | "middle" | "bottom",
        },
      },
    );
  }
  if (
    typeof value === "string"
    && (
      property === "fontFamily"
      || property === "fontSize"
      || property === "lineType"
      || property === "startCap"
      || property === "endCap"
    )
  ) {
    return fxCreateSelectionStyleDataPatch(
      { now },
      { element, property, value },
    );
  }
  return null;
}

function createPlan(
  portal: TPortalMountSelectionStyleMenu,
  property: TSelectionStyleProperty,
  value: string | number,
): TSelectionStylePlan | null {
  const selected = selectedElements(portal);
  const targets = isTextProperty(property)
    ? fnResolveSelectionStyleTextElements({ elements: selected })
    : selected;
  const after: TElement[] = [];
  for (const element of targets) {
    const config = portal.element.getSelectionStyleMenuConfigByElement({
      element,
      theme: portal.theme,
    });
    if (!fnHasSelectionStylePropertySupport({ config, property })) {
      continue;
    }
    const patched = patchElement(portal, element, property, value);
    if (patched === null) {
      continue;
    }
    after.push(patched);
  }
  return after.length === 0 ? null : { after };
}

function commitPlan(
  portal: TPortalMountSelectionStyleMenu,
  plan: TSelectionStylePlan,
): TCrdtCommitResult {
  const builder = portal.crdt.build();
  for (const element of plan.after) {
    builder.patchElement(element.id, element);
  }
  return builder.commit();
}

function recordCommit(
  portal: TPortalMountSelectionStyleMenu,
  property: TSelectionStyleProperty,
  commit: TCrdtCommitResult,
): void {
  portal.history.record({
    label: `selection-style-${property}`,
    undo: () => {
      commit.rollback();
    },
    redo: () => {
      portal.crdt.applyOps({ ops: commit.redoOps });
    },
  });
}

export function txMountSelectionStyleMenu(
  portal: TPortalMountSelectionStyleMenu,
  args: TArgsMountSelectionStyleMenu,
) {
  void args;
  const mountElement = portal.scene.container.ownerDocument.createElement("div");
  mountElement.id = "selection-style-menu";
  Object.assign(mountElement.style, {
    position: "absolute",
    inset: "0",
    pointerEvents: "none",
    zIndex: "50",
  });
  portal.scene.container.appendChild(mountElement);
  const [version, setVersion] = portal.createSignal(0);
  const sync = () => setVersion((value) => value + 1);
  let pendingOpacityCommit: TPendingOpacityCommit | null = null;
  let pendingOpacityTimer: number | null = null;

  const clearPendingOpacityTimer = () => {
    if (pendingOpacityTimer === null) {
      return;
    }
    portal.clearTimeout(pendingOpacityTimer);
    pendingOpacityTimer = null;
  };

  const flushPendingOpacityCommit = () => {
    clearPendingOpacityTimer();
    const pending = pendingOpacityCommit;
    pendingOpacityCommit = null;
    if (pending === null) {
      return;
    }
    portal.history.record({
      label: "selection-style-opacity",
      undo: () => {
        portal.crdt.applyOps({ ops: pending.undoOps });
      },
      redo: () => {
        portal.crdt.applyOps({ ops: pending.redoOps });
      },
    });
  };

  const syncAtInteractionBoundary = () => {
    flushPendingOpacityCommit();
    sync();
  };
  const disposers = [
    portal.selection.hooks.change.tap(syncAtInteractionBoundary),
    portal.tool.hooks.activeToolChange.tap(syncAtInteractionBoundary),
    portal.session.hooks.editingChange.tap(syncAtInteractionBoundary),
    portal.element.hooks.elementsChange.tap(syncAtInteractionBoundary),
    portal.crdt.hooks.change.tap(sync),
    portal.theme.hooks.change.tap(sync),
    portal.theme.hooks.rememberedStyleChange.tap(sync),
  ];
  let menuRoot: HTMLDivElement | undefined;

  const disposeRender = portal.render(() => {
    const elements = portal.createMemo(() => {
      version();
      return selectedElements(portal);
    });
    const entries = portal.createMemo(() => {
      return elements().flatMap((element) => {
        const config = portal.element.getSelectionStyleMenuConfigByElement({
          element,
          theme: portal.theme,
        });
        return config === null || config === undefined
          ? []
          : [{ element, config }];
      });
    });
    const configs = portal.createMemo(() => {
      return entries().map((entry) => entry.config);
    });
    const textElements = portal.createMemo(() => {
      return fnResolveSelectionStyleTextElements({
        elements: elements(),
      });
    });
    const sections = portal.createMemo(() => {
      return fnGetSelectionStyleMenuSections({ configs: configs() });
    });
    const values = portal.createMemo(() => {
      return fnGetSelectionStyleMenuValues({
        elements: elements(),
        textElements: textElements(),
        configs: configs(),
      });
    });
    const visible = portal.createMemo(() => {
      version();
      if (portal.session.editingId !== null || entries().length === 0) {
        return false;
      }
      return Object.values(sections()).some(Boolean);
    });
    const strokeWidthOptions = portal.createMemo(() => {
      return fnGetSelectionStyleStrokeWidthOptions({
        configs: configs(),
      }) ?? [];
    });
    const colorPalette = portal.createMemo(() => {
      version();
      return portal.theme.getThemeColorPickerPalette();
    });
    const apply = (
      property: TSelectionStyleProperty,
      value: string | number,
    ) => {
      const plan = createPlan(portal, property, value);
      const activeTool = portal.tool.getTool(portal.tool.activeToolId);
      const activeToolId = activeTool?.behavior.type === "mode"
        && activeTool.behavior.mode !== "select"
        && activeTool.behavior.mode !== "hand"
        && fnHasSelectionStylePropertySupport({
          config: portal.element.getSelectionStyleMenuConfigById({
            id: activeTool.id,
            theme: portal.theme,
          }),
          property,
        })
        ? activeTool.id
        : null;
      const rememberedUpdates = fnGetSelectionStyleRememberedUpdates({
        activeToolId,
        elements: plan?.after ?? [],
        property,
        value,
      });
      for (const update of rememberedUpdates) {
        portal.theme.setRememberedStyle(update.scope, update.patch);
      }

      if (plan !== null) {
        const commit = commitPlan(portal, plan);
        if (property === "opacity") {
          pendingOpacityCommit = {
            undoOps: pendingOpacityCommit?.undoOps ?? commit.undoOps,
            redoOps: commit.redoOps,
          };
          clearPendingOpacityTimer();
          pendingOpacityTimer = portal.setTimeout(
            flushPendingOpacityCommit,
            OPACITY_COMMIT_DEBOUNCE_MS,
          );
        } else {
          flushPendingOpacityCommit();
          recordCommit(portal, property, commit);
        }
        sync();
      }
      menuRoot?.focus();
    };

    return portal.createComponent(portal.SelectionStyleMenu, {
      visible,
      sections,
      values,
      strokeWidthOptions,
      colorPalette,
      rootRef: (element) => {
        menuRoot = element;
      },
      onEscape: () => {
        portal.tool.setActiveTool("select");
        portal.scene.container.focus();
      },
      onInteraction: () => menuRoot?.focus(),
      onFillChange: (value) => apply("fill", value),
      onStrokeChange: (value) => apply("stroke", value),
      onStrokeWidthChange: (value) => apply("strokeWidth", value),
      onOpacityChange: (value) => apply("opacity", value),
      onFontFamilyChange: (value: TFontFamily) => {
        apply("fontFamily", value);
      },
      onFontSizeChange: (value) => apply("fontSize", value),
      onTextAlignChange: (value) => apply("textAlign", value),
      onVerticalAlignChange: (value) => apply("verticalAlign", value),
      onLineTypeChange: (value: TLineType) => {
        apply("lineType", value);
      },
      onStartCapChange: (value: TCapStyle) => {
        apply("startCap", value);
      },
      onEndCapChange: (value: TCapStyle) => {
        apply("endCap", value);
      },
    });
  }, mountElement);

  return {
    mountElement,
    dispose() {
      flushPendingOpacityCommit();
      for (const dispose of disposers.reverse()) {
        dispose();
      }
      disposeRender();
      mountElement.remove();
    },
  };
}
