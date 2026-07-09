import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import type { ThemeService } from "@vibecanvas/service-theme";
import type Konva from "konva";
import type * as Solid from "solid-js";
import type * as SolidWeb from "solid-js/web";
import type { SelectionStyleMenu as TSelectionStyleMenuComponent } from "../../components/SelectionStyleMenu";
import type { TCapStyle, TFontFamily, TLineType } from "../../components/SelectionStyleMenu/types";
import { fnResolveSelectionStyleTextElements } from "../../core/fn.resolve-selection-style-text-elements";
import {
  fnGetSelectionStyleMenuSections,
  fnGetSelectionStyleMenuValues,
  fnGetSelectionStyleMenuValuesWithOverrides,
  fnGetSelectionStyleStrokeWidthOptions,
  fnHasSelectionStylePropertySupport,
  type TSelectionStyleProperty,
} from "../../core/fn.selection-style-menu";
import { fxResolveSelectionStyleElements } from "../../core/fx.resolve-selection-style-elements";
import type {
  TPortalApplySelectionStyleChange,
  TSelectionStyleChangePlan,
  txApplySelectionStyleChange as TTxApplySelectionStyleChange,
  txApplySelectionStyleChangeRuntime as TTxApplySelectionStyleChangeRuntime,
  txCommitSelectionStyleChange as TTxCommitSelectionStyleChange,
  txCreateSelectionStyleChangePlan as TTxCreateSelectionStyleChangePlan,
} from "../../core/tx.apply-selection-style-change";
import type {
  CrdtService,
  ElementService,
  HistoryService,
  SceneService, SelectionService,
  SessionService,
  TElementSelectionStyleConfig,
  ToolService
} from "../../services";
import { fxFindShape1dNodeById } from "../shape1d/fx.node";

const OPACITY_COMMIT_DEBOUNCE_MS = 120;

type TSelectionStyleMenuTimer = number | ReturnType<typeof globalThis.setTimeout>;

type TPortalMountSelectionStyleMenu = {
  Konva: typeof Konva;
  SelectionStyleMenu: typeof TSelectionStyleMenuComponent;
  createComponent: typeof Solid.createComponent;
  createMemo: typeof Solid.createMemo;
  createSignal: typeof Solid.createSignal;
  renderSolid: typeof SolidWeb.render;
  txApplySelectionStyleChange: typeof TTxApplySelectionStyleChange;
  txApplySelectionStyleChangeRuntime: typeof TTxApplySelectionStyleChangeRuntime;
  txCommitSelectionStyleChange: typeof TTxCommitSelectionStyleChange;
  txCreateSelectionStyleChangePlan: typeof TTxCreateSelectionStyleChangePlan;
  setTimeout: (handler: () => void, timeout?: number) => TSelectionStyleMenuTimer;
  clearTimeout: (timer: TSelectionStyleMenuTimer | null) => void;
  element: ElementService;
  crdt: CrdtService;
  session: SessionService;
  history: HistoryService;
  scene: SceneService;
  selection: SelectionService;
  theme: ThemeService;
  tool: ToolService;
};

type TArgsMountSelectionStyleMenu = Record<string, never>;

function mergeSelectionStyleChangePlans(args: {
  current: TSelectionStyleChangePlan | null;
  next: TSelectionStyleChangePlan;
}) {
  if (!args.current) {
    return args.next;
  }

  const beforeById = new Map(args.current.beforeById);
  args.next.beforeById.forEach((element, id) => {
    if (!beforeById.has(id)) {
      beforeById.set(id, element);
    }
  });

  return {
    beforeById,
    afterElements: args.next.afterElements,
  } satisfies TSelectionStyleChangePlan;
}

function fnGetSelectionStyleOverridesFromRememberedStyle(rememberedStyle: ReturnType<ThemeService["getRememberedStyle"]>) {
  return {
    fillColor: typeof rememberedStyle.fillColor === "string"
      ? rememberedStyle.fillColor
      : rememberedStyle.backgroundColor,
    strokeColor: rememberedStyle.strokeColor,
    strokeWidth: rememberedStyle.strokeWidth,
    opacity: rememberedStyle.opacity,
    fontFamily: rememberedStyle.fontFamily as TFontFamily | undefined,
    fontSize: rememberedStyle.fontSize,
    textAlign: rememberedStyle.textAlign,
    verticalAlign: rememberedStyle.verticalAlign,
    lineType: rememberedStyle.lineType as TLineType | undefined,
    startCap: rememberedStyle.startCap as TCapStyle | undefined,
    endCap: rememberedStyle.endCap as TCapStyle | undefined,
  };
}

export function fxMountSelectionStyleMenu(portal: TPortalMountSelectionStyleMenu, args: TArgsMountSelectionStyleMenu) {
  void args;

  const mountElement = portal.scene.container.ownerDocument.createElement("div");
  Object.assign(mountElement.style, {
    position: "absolute",
    inset: "0",
    pointerEvents: "none",
    zIndex: "50",
  });
  portal.scene.stage.container().appendChild(mountElement);

  const txRefreshEditingShape1d = () => {
    if (portal.session.editingId === null) {
      return;
    }

    const editingNode = fxFindShape1dNodeById({ Shape: portal.Konva.Shape, render: portal.scene }, { id: portal.session.editingId });
    editingNode?.getLayer()?.batchDraw();
  };

  const txPortal: TPortalApplySelectionStyleChange = {
    crdt: portal.crdt,
    element: portal.element,
    history: portal.history,
    scene: portal.scene,
    selection: portal.selection,
    txRefreshEditingShape1d,
    now: () => Date.now(),
  };

  let pendingOpacityCommitPlan: TSelectionStyleChangePlan | null = null;
  let pendingOpacityCommitTimer: TSelectionStyleMenuTimer | null = null;

  const clearPendingOpacityCommit = () => {
    if (pendingOpacityCommitTimer !== null) {
      portal.clearTimeout(pendingOpacityCommitTimer);
      pendingOpacityCommitTimer = null;
    }
  };

  const flushOpacityCommit = () => {
    if (!pendingOpacityCommitPlan) {
      return;
    }

    portal.txCommitSelectionStyleChange(txPortal, {
      property: "opacity",
      plan: pendingOpacityCommitPlan,
    });
    pendingOpacityCommitPlan = null;
    pendingOpacityCommitTimer = null;
  };

  const scheduleSelectionStyleCommit = (plan: TSelectionStyleChangePlan) => {
    pendingOpacityCommitPlan = mergeSelectionStyleChangePlans({
      current: pendingOpacityCommitPlan,
      next: plan,
    });
    clearPendingOpacityCommit();
    pendingOpacityCommitTimer = portal.setTimeout(() => {
      flushOpacityCommit();
    }, OPACITY_COMMIT_DEBOUNCE_MS);
  };

  let menuRoot: HTMLDivElement | undefined;

  const txFocusMenuRoot = () => {
    portal.setTimeout(() => {
      menuRoot?.focus();
    }, 0);
  };

  const txFocusCanvas = () => {
    portal.scene.stage.container().focus();
  };

  const [version, setVersion] = portal.createSignal(0);
  const syncVersion = () => {
    setVersion((value) => value + 1);
  };

  portal.selection.hooks.change.tap(syncVersion);
  portal.tool.hooks.activeToolChange.tap(syncVersion);
  portal.session.hooks.editingChange.tap(syncVersion);
  portal.element.hooks.elementsChange.tap(syncVersion);
  portal.crdt.hooks.change.tap(syncVersion);
  portal.theme.hooks.change.tap(syncVersion);
  portal.theme.hooks.rememberedStyleChange.tap(syncVersion);

  const disposeRender = portal.renderSolid(() => {
    const selectedElements = portal.createMemo(() => {
      version();
      return fxResolveSelectionStyleElements({
        element: portal.element,
        scene: portal.scene,
        selection: portal.selection,
      });
    });

    const selectedEntries = portal.createMemo(() => {
      version();

      const entries: Array<{ element: TElement; config: TElementSelectionStyleConfig }> = [];
      selectedElements().forEach((element) => {
        const config = portal.element.getSelectionStyleMenuConfigByElement({
          element,
          theme: portal.theme,
        });
        if (!config) {
          return;
        }

        entries.push({ element, config });
      });

      return entries;
    });

    const elements = portal.createMemo(() => {
      return selectedEntries().map((entry) => entry.element);
    });

    const textElements = portal.createMemo(() => {
      version();

      return fnResolveSelectionStyleTextElements({
        elements: elements(),
      }).filter((element) => {
        return portal.element.getSelectionStyleMenuConfigByElement({
          element,
          theme: portal.theme,
        }) !== null;
      });
    });

    const activeToolId = portal.createMemo(() => {
      version();

      const activeTool = portal.tool.getTool(portal.tool.activeToolId);
      if (!activeTool || activeTool.behavior.type !== "mode") {
        return null;
      }

      if (activeTool.behavior.mode === "hand" || activeTool.behavior.mode === "select") {
        return null;
      }

      return activeTool.id;
    });

    const activeToolConfig = portal.createMemo(() => {
      const toolId = activeToolId();
      if (!toolId) {
        return null;
      }

      return portal.element.getSelectionStyleMenuConfigById({
        id: toolId,
        theme: portal.theme,
      });
    });

    const activeToolRememberedValues = portal.createMemo(() => {
      version();

      const toolId = activeToolId();
      if (!toolId) {
        return {};
      }

      return portal.theme.getRememberedStyle(toolId);
    });

    const configs = portal.createMemo(() => {
      const entries = selectedEntries();
      return entries.map((entry) => entry.config);
    });

    const sections = portal.createMemo(() => {
      return fnGetSelectionStyleMenuSections({
        configs: configs(),
      });
    });

    const visible = portal.createMemo(() => {
      version();

      const textareaMounted = portal.scene.stage.container().querySelector("textarea") !== null;
      const isEditingTextActive = portal.session.editingId !== null && textareaMounted;
      if (isEditingTextActive) {
        return false;
      }

      if (selectedEntries().length === 0) {
        return false;
      }

      const next = sections();
      return next.showFillPicker
        || next.showStrokeColorPicker
        || next.showStrokeWidthPicker
        || next.showTextPickers
        || next.showOpacityPicker
        || next.showLineTypePicker
        || next.showStartCapPicker
        || next.showEndCapPicker;
    });

    const values = portal.createMemo(() => {
      const resolvedValues = fnGetSelectionStyleMenuValues({
        elements: elements(),
        textElements: textElements(),
        configs: configs(),
      });

      if (elements().length > 0) {
        return resolvedValues;
      }

      return fnGetSelectionStyleMenuValuesWithOverrides({
        values: resolvedValues,
        overrides: fnGetSelectionStyleOverridesFromRememberedStyle(activeToolRememberedValues()),
      });
    });

    const strokeWidthOptions = portal.createMemo(() => {
      return fnGetSelectionStyleStrokeWidthOptions({
        configs: configs(),
      });
    });

    const colorPalette = portal.createMemo(() => {
      version();
      return portal.theme.getThemeColorPickerPalette();
    });

    const applyStyle = (property: TSelectionStyleProperty, value: string | number) => {
      const toolId = activeToolId();
      const toolConfig = activeToolConfig();
      const valueKey = (() => {
        switch (property) {
          case "fill":
            return "fillColor" as const;
          case "stroke":
            return "strokeColor" as const;
          case "strokeWidth":
            return "strokeWidth" as const;
          case "opacity":
            return "opacity" as const;
          case "fontFamily":
            return "fontFamily" as const;
          case "fontSize":
            return "fontSize" as const;
          case "textAlign":
            return "textAlign" as const;
          case "verticalAlign":
            return "verticalAlign" as const;
          case "lineType":
            return "lineType" as const;
          case "startCap":
            return "startCap" as const;
          case "endCap":
            return "endCap" as const;
        }
      })();

      if (toolId && fnHasSelectionStylePropertySupport({ config: toolConfig, property })) {
        portal.theme.setRememberedStyle(toolId, { [valueKey]: value } as never);
      }

      if (elements().length === 0) {
        syncVersion();
        txFocusMenuRoot();
        return;
      }

      if (property === "opacity") {
        const plan = portal.txCreateSelectionStyleChangePlan(txPortal, { property, value });
        if (plan) {
          portal.txApplySelectionStyleChangeRuntime(txPortal, { plan });
          scheduleSelectionStyleCommit(plan);
          syncVersion();
          txFocusMenuRoot();
        }
        return;
      }

      portal.txApplySelectionStyleChange(txPortal, { property, value });
      syncVersion();
      txFocusMenuRoot();
    };

    return portal.createComponent(portal.SelectionStyleMenu, {
      visible,
      sections,
      values,
      strokeWidthOptions: () => strokeWidthOptions() ?? [],
      colorPalette,
      rootRef: (element) => {
        menuRoot = element;
      },
      onEscape: () => {
        portal.tool.setActiveTool("select");
        txFocusCanvas();
        syncVersion();
      },
      onInteraction: () => {
        txFocusMenuRoot();
      },
      onFillChange: (color) => applyStyle("fill", color),
      onStrokeChange: (color) => applyStyle("stroke", color),
      onStrokeWidthChange: (width) => applyStyle("strokeWidth", width),
      onOpacityChange: (opacity) => applyStyle("opacity", opacity),
      onFontFamilyChange: (fontFamily: TFontFamily) => applyStyle("fontFamily", fontFamily),
      onFontSizeChange: (fontSize) => applyStyle("fontSize", fontSize),
      onTextAlignChange: (textAlign) => applyStyle("textAlign", textAlign),
      onVerticalAlignChange: (verticalAlign) => applyStyle("verticalAlign", verticalAlign),
      onLineTypeChange: (lineType: TLineType) => applyStyle("lineType", lineType),
      onStartCapChange: (capStyle: TCapStyle) => applyStyle("startCap", capStyle),
      onEndCapChange: (capStyle: TCapStyle) => applyStyle("endCap", capStyle),
    });
  }, mountElement);

  return {
    mountElement,
    dispose() {
      clearPendingOpacityCommit();
      disposeRender();
      mountElement.remove();
    },
  };
}
