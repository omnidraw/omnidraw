import type { layoutWithLines, prepareWithSegments } from "@chenglou/pretext";
import type { TElement, TTextData } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import type { ThemeService } from "@vibecanvas/service-theme";
import type Konva from "konva";
import {
  fnCreateShape2dInlineTextElement,
  fnGetShape2dElementSize,
  fnGetShape2dTextData,
  fnIsShape2dElementType,
  fnRemoveShape2dInlineText,
} from "../../core/fn.shape2d";
import { fxMeasureTextLayout } from "../../core/fx.pretext";
import type {
  CameraService, CrdtService, ElementService,
  HistoryService, SceneService, SelectionService,
  SessionService
} from "../../services";
import { SHAPE2D_INLINE_TEXT_HOST_ID_ATTR } from "../shape2d/CONSTANTS";
import { fnGetShapeTextHostBounds } from "../shape2d/fn.text-host-bounds";
import { DEFAULT_TEXT_LINE_HEIGHT } from "./CONSTANTS";
import { fnComputeTextHeight } from "./fn.compute-text-height";
import { fxComputeTextWidth } from "./fx.compute-text-width";
import { fxToTextElement } from "./fx.to-text-element";
import { txUpdateTextNodeFromElement } from "./tx.update-text-node-from-element";

export type TPortalEnterEditMode = {
  Konva: typeof Konva;
  camera: Pick<CameraService, "hooks">;
  element: ElementService;
  session: SessionService;
  crdt: CrdtService;
  document: Document;
  history: HistoryService;
  scene: SceneService;
  selection: SelectionService;
  theme: ThemeService;
  pretext: {
    layoutWithLines: typeof layoutWithLines;
    prepareWithSegments: typeof prepareWithSegments;
  };
};

export type TArgsEnterEditMode = {
  freeTextName: string;
  isNew: boolean;
  node: Konva.Text;
  shapeTextHostNode?: Konva.Shape;
};

function findShapeTextHostNode(portal: TPortalEnterEditMode, hostId: string) {
  const node = portal.scene.staticForegroundLayer.findOne((candidate: Konva.Node) => {
    return candidate.id() === hostId
      && (candidate instanceof portal.Konva.Rect || candidate instanceof portal.Konva.Ellipse || candidate instanceof portal.Konva.Line);
  });

  if (!(node instanceof portal.Konva.Rect) && !(node instanceof portal.Konva.Ellipse) && !(node instanceof portal.Konva.Line)) {
    return null;
  }

  return node;
}

function findCurrentTextNode(portal: TPortalEnterEditMode, id: string) {
  const node = portal.scene.staticForegroundLayer.findOne((candidate: Konva.Node) => {
    return candidate instanceof portal.Konva.Text && candidate.id() === id;
  });

  return node instanceof portal.Konva.Text ? node : null;
}

function restoreTextSelectionLater(portal: TPortalEnterEditMode, args: { nodeId: string }) {
  portal.document.defaultView?.setTimeout(() => {
    const selectedNode = findCurrentTextNode(portal, args.nodeId);
    if (!selectedNode) {
      return;
    }

    portal.selection.setSelection([selectedNode]);
    portal.selection.setFocusedNode(selectedNode);
  }, 0);
}

function suppressNextSelectionHandling(portal: TPortalEnterEditMode, args: { reason: "commit" | "cancel" }) {
  void args;
  portal.selection.suppressSelectionHandling(120);
}

function fxGetNodeElement(portal: TPortalEnterEditMode, args: { node: Konva.Node }) {
  return portal.element?.toElement(args.node) ?? portal.element.toElement?.(args.node) ?? null;
}

function applyRuntimeElement(portal: TPortalEnterEditMode, args: { element: TElement }) {
  return portal.element?.updateElement(args.element) ?? false;
}

function fxSyncTextareaColor(portal: TPortalEnterEditMode, args: {
  element: Pick<TElement, "style">;
  textarea: HTMLTextAreaElement;
}) {
  args.textarea.style.color = portal.theme.resolveThemeColor(
    args.element.style.strokeColor,
    portal.theme.getTheme().colors.canvasText,
  ) ?? portal.theme.getTheme().colors.canvasText;
}

export function txEnterEditMode(portal: TPortalEnterEditMode, args: TArgsEnterEditMode) {
  let activeNode = args.node;
  const now = Date.now();
  const originalElement = fxToTextElement({Date}, { node: activeNode });
  const originalText = activeNode.text();
  const originalData = originalElement.data as TTextData;
  const resolvedShapeTextHostNode = args.shapeTextHostNode
    ?? (() => {
      const hostId = activeNode.getAttr(SHAPE2D_INLINE_TEXT_HOST_ID_ATTR) as string | undefined;
      return typeof hostId === "string" ? findShapeTextHostNode(portal, hostId) : null;
    })();
  const originalHostElement = resolvedShapeTextHostNode
    ? fxGetNodeElement(portal, { node: resolvedShapeTextHostNode })
    : null;
  const isShapeInlineText = Boolean(
    resolvedShapeTextHostNode
      && originalHostElement
      && fnIsShape2dElementType(originalHostElement.data.type),
  );
  const originalInlineTextData = isShapeInlineText && originalHostElement
    ? fnGetShape2dTextData(originalHostElement)
    : null;

  portal.session.editingId = activeNode.id();
  activeNode.visible(false);
  portal.scene.stage.batchDraw();

  const textarea = portal.document.createElement("textarea");
  const initialAbsoluteScale = activeNode.getAbsoluteScale();
  const initialScaledFontSize = activeNode.fontSize() * initialAbsoluteScale.x;
  const initialHostHeight = isShapeInlineText && originalHostElement
    ? (fnGetShape2dElementSize(originalHostElement)?.height ?? originalData.h)
    : originalData.h;

  const buildShapeInlineHostElement = (args: {
    text: string;
    minHeight: number;
  }): TElement | null => {
    if (!isShapeInlineText || !originalHostElement || !fnIsShape2dElementType(originalHostElement.data.type)) {
      return null;
    }

    return fnCreateShape2dInlineTextElement({
      element: structuredClone(originalHostElement),
      text: args.text,
      fontFamily: activeNode.fontFamily(),
      minHeight: args.minHeight,
    }) as TElement;
  };

  const buildShapeInlineRemovalElement = (): TElement | null => {
    if (!isShapeInlineText || !originalHostElement || !fnIsShape2dElementType(originalHostElement.data.type)) {
      return null;
    }

    return fnRemoveShape2dInlineText(structuredClone(originalHostElement)) as TElement;
  };

  const syncShapeInlineEditingLayout = () => {
    if (!isShapeInlineText || !resolvedShapeTextHostNode) {
      return;
    }

    const measured = fxMeasureTextLayout(portal.pretext, {
      text: textarea.value,
      fontSize: activeNode.fontSize(),
      fontFamily: activeNode.fontFamily(),
      fontStyle: activeNode.fontStyle(),
      lineHeight: DEFAULT_TEXT_LINE_HEIGHT,
      width: activeNode.width(),
    });
    const nextHostElement = buildShapeInlineHostElement({
      text: textarea.value,
      minHeight: Math.max(initialHostHeight, measured.height),
    });

    if (nextHostElement) {
      applyRuntimeElement(portal, { element: nextHostElement });
      activeNode = findCurrentTextNode(portal, activeNode.id()) ?? activeNode;
    }

    const hostBounds = fnGetShapeTextHostBounds({
      Rect: portal.Konva.Rect,
      Ellipse: portal.Konva.Ellipse,
      Line: portal.Konva.Line,
      node: resolvedShapeTextHostNode,
    });
    if (hostBounds) {
      activeNode.position({ x: hostBounds.x, y: hostBounds.y });
      activeNode.rotation(hostBounds.rotation);
      activeNode.width(Math.max(4, hostBounds.width));
      activeNode.height(Math.max(4, hostBounds.height));
    }

    const absolutePosition = activeNode.getAbsolutePosition();
    const absoluteScale = activeNode.getAbsoluteScale();
    const absoluteRotation = activeNode.getAbsoluteRotation();
    const scaledFontSize = activeNode.fontSize() * absoluteScale.x;
    const scaledWidth = Math.max(activeNode.width() * absoluteScale.x, 4);
    const scaledHeight = Math.max(activeNode.height() * absoluteScale.y, initialScaledFontSize);
    const contentHeight = measured.height * absoluteScale.y;
    const remainingHeight = Math.max(0, scaledHeight - contentHeight);
    const verticalPadding = remainingHeight / 2;

    textarea.style.top = `${absolutePosition.y}px`;
    textarea.style.left = `${absolutePosition.x}px`;
    textarea.style.fontSize = `${scaledFontSize}px`;
    textarea.style.width = `${scaledWidth}px`;
    textarea.style.height = `${scaledHeight}px`;
    textarea.style.minHeight = `${scaledHeight}px`;
    textarea.style.transform = `rotate(${absoluteRotation}deg)`;
    textarea.style.paddingLeft = "0px";
    textarea.style.paddingRight = "0px";
    textarea.style.paddingTop = `${verticalPadding}px`;
    textarea.style.paddingBottom = `${verticalPadding}px`;
    textarea.style.overflow = "hidden";
  };

  const autoGrow = () => {
    if (isShapeInlineText) {
      syncShapeInlineEditingLayout();
      portal.scene.staticForegroundLayer.batchDraw();
      return;
    }

    const absolutePosition = activeNode.getAbsolutePosition();
    const absoluteScale = activeNode.getAbsoluteScale();
    const absoluteRotation = activeNode.getAbsoluteRotation();
    const scaledFontSize = activeNode.fontSize() * absoluteScale.x;
    const scaledWidth = Math.max(activeNode.width() * absoluteScale.x, 4);

    textarea.style.top = `${absolutePosition.y}px`;
    textarea.style.left = `${absolutePosition.x}px`;
    textarea.style.fontSize = `${scaledFontSize}px`;
    textarea.style.minHeight = `${scaledFontSize}px`;
    textarea.style.transform = `rotate(${absoluteRotation}deg)`;
    textarea.style.width = "auto";
    textarea.style.width = `${Math.max(textarea.scrollWidth, scaledWidth)}px`;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.max(textarea.scrollHeight, scaledFontSize)}px`;
  };

  textarea.value = activeNode.text();
  Object.assign(textarea.style, {
    position: "absolute",
    top: `${activeNode.getAbsolutePosition().y}px`,
    left: `${activeNode.getAbsolutePosition().x}px`,
    width: `${Math.max(activeNode.width() * initialAbsoluteScale.x, 4)}px`,
    minHeight: `${initialScaledFontSize}px`,
    fontSize: `${initialScaledFontSize}px`,
    fontFamily: activeNode.fontFamily(),
    lineHeight: String(DEFAULT_TEXT_LINE_HEIGHT),
    textAlign: activeNode.align(),
    transform: `rotate(${activeNode.getAbsoluteRotation()}deg)`,
    transformOrigin: "top left",
    whiteSpace: "pre-wrap",
    outline: "none",
    boxShadow: "none",
    background: "transparent",
    border: "none",
    resize: "none",
    overflow: "hidden",
    padding: "0",
    boxSizing: "border-box",
    zIndex: "9999",
  });
  fxSyncTextareaColor(portal, { element: originalElement, textarea });
  const offThemeChange = portal.theme.hooks.change.tap(() => {
    fxSyncTextareaColor(portal, { element: originalElement, textarea });
  });
  const offCameraChange = portal.camera.hooks.change.tap(() => {
    autoGrow();
  });

  let didCleanup = false;
  const cleanup = () => {
    if (didCleanup) {
      return;
    }

    didCleanup = true;
    offThemeChange();
    offCameraChange();
    textarea.removeEventListener("input", autoGrow);
    textarea.removeEventListener("blur", commit);
    textarea.removeEventListener("keydown", onKeyDown);
    textarea.removeEventListener("keyup", stopKeyPropagation);
    if (textarea.parentNode) {
      textarea.remove();
    }
    portal.session.editingId = null;
  };

  const commitShapeInlineText = (args: {
    newText: string;
    worldHeight: number;
  }) => {
    if (!resolvedShapeTextHostNode || !originalHostElement || !fnIsShape2dElementType(originalHostElement.data.type)) {
      return;
    }

    if (args.newText === "" && originalInlineTextData === null) {
      applyRuntimeElement(portal, { element: originalHostElement });
      portal.scene.staticForegroundLayer.batchDraw();
      portal.selection.setSelection([resolvedShapeTextHostNode]);
      portal.selection.setFocusedNode(resolvedShapeTextHostNode);
      return;
    }

    const baseNextHostElement = args.newText === ""
      ? buildShapeInlineRemovalElement()
      : buildShapeInlineHostElement({
          text: args.newText,
          minHeight: Math.max(initialHostHeight, args.worldHeight),
        });
    if (!baseNextHostElement) {
      applyRuntimeElement(portal, { element: originalHostElement });
      portal.scene.staticForegroundLayer.batchDraw();
      portal.selection.setSelection([resolvedShapeTextHostNode]);
      portal.selection.setFocusedNode(resolvedShapeTextHostNode);
      return;
    }

    const didHostChange = JSON.stringify(baseNextHostElement) !== JSON.stringify(originalHostElement);
    if (!didHostChange) {
      applyRuntimeElement(portal, { element: originalHostElement });
      portal.scene.staticForegroundLayer.batchDraw();
      portal.selection.setSelection([resolvedShapeTextHostNode]);
      portal.selection.setFocusedNode(resolvedShapeTextHostNode);
      return;
    }

    const nextHostElement = {
      ...baseNextHostElement,
      updatedAt: Date.now(),
    } satisfies TElement;
    applyRuntimeElement(portal, { element: nextHostElement });
    portal.scene.staticForegroundLayer.batchDraw();

    const commitResult = (() => {
      const builder = portal.crdt.build();
      builder.patchElement(nextHostElement.id, nextHostElement);
      return builder.commit();
    })();

    portal.selection.setSelection([resolvedShapeTextHostNode]);
    portal.selection.setFocusedNode(resolvedShapeTextHostNode);

    const undoHostElement = structuredClone(originalHostElement);
    const redoHostElement = structuredClone(nextHostElement);

    portal.history.record({
      label: "edit-text",
      undo: () => {
        applyRuntimeElement(portal, { element: undoHostElement });
        portal.scene.staticForegroundLayer.batchDraw();
        commitResult.rollback();
      },
      redo: () => {
        applyRuntimeElement(portal, { element: redoHostElement });
        portal.scene.staticForegroundLayer.batchDraw();
        portal.crdt.applyOps({ ops: commitResult.redoOps });
      },
    });
  };

  const commit = () => {
    suppressNextSelectionHandling(portal, { reason: "commit" });

    const newText = textarea.value;
    const absoluteScale = activeNode.getAbsoluteScale();
    const fallbackScaledWidth = Math.max(activeNode.width() * absoluteScale.x, 4);
    const fallbackScaledHeight = Math.max(activeNode.height() * absoluteScale.y, initialScaledFontSize);
    const screenWidth = parseFloat(textarea.style.width) || fallbackScaledWidth;
    const screenHeight = parseFloat(textarea.style.height) || fallbackScaledHeight;
    const worldWidth = screenWidth / absoluteScale.x;
    const worldHeight = screenHeight / absoluteScale.y;

    cleanup();

    if (isShapeInlineText) {
      commitShapeInlineText({
        newText,
        worldHeight,
      });
      return;
    }

    if (args.isNew && newText === "") {
      activeNode.destroy();
      portal.scene.staticForegroundLayer.batchDraw();
      portal.selection.clear();
      return;
    }

    const textToSet = newText;
    activeNode.text(textToSet);
    activeNode.wrap("none");
    activeNode.setAttr("vcOriginalText", textToSet);

    const measured = fxMeasureTextLayout(portal.pretext, {
      text: textToSet,
      fontSize: activeNode.fontSize(),
      fontFamily: activeNode.fontFamily(),
      fontStyle: activeNode.fontStyle(),
      lineHeight: DEFAULT_TEXT_LINE_HEIGHT,
      width: worldWidth,
    });
    const computedWidth = fxComputeTextWidth({ document: portal.document }, { node: activeNode, text: textToSet });
    const computedHeight = fnComputeTextHeight({
      fontSize: activeNode.fontSize(),
      lineHeight: DEFAULT_TEXT_LINE_HEIGHT,
      padding: activeNode.padding(),
      text: textToSet,
    });
    activeNode.width(Math.max(worldWidth, measured.maxLineWidth, computedWidth));
    activeNode.height(Math.max(worldHeight, measured.height, computedHeight));
    activeNode.visible(true);
    portal.scene.staticForegroundLayer.batchDraw();

    const nextElement = fxToTextElement({Date}, { node: activeNode, });
    const commitResult = (() => {
      const builder = portal.crdt.build();
      builder.patchElement(nextElement.id, nextElement);
      return builder.commit();
    })();

    const selectedNode = findCurrentTextNode(portal, activeNode.id()) ?? activeNode;
    portal.selection.setSelection([selectedNode]);
    portal.selection.setFocusedNode(selectedNode);
    restoreTextSelectionLater(portal, { nodeId: activeNode.id() });

    if (textToSet === originalText) {
      return;
    }

    const undoElement = structuredClone(originalElement);
    const redoElement = structuredClone(nextElement);

    portal.history.record({
      label: "edit-text",
      undo: () => {
        txUpdateTextNodeFromElement({ Konva: portal.Konva, scene: portal.scene, theme: portal.theme }, { element: undoElement, freeTextName: args.freeTextName });
        portal.scene.staticForegroundLayer.batchDraw();
        commitResult.rollback();
      },
      redo: () => {
        txUpdateTextNodeFromElement({ Konva: portal.Konva, scene: portal.scene, theme: portal.theme }, { element: redoElement, freeTextName: args.freeTextName });
        portal.scene.staticForegroundLayer.batchDraw();
        portal.crdt.applyOps({ ops: commitResult.redoOps });
      },
    });
  };

  const cancel = () => {
    suppressNextSelectionHandling(portal, { reason: "cancel" });
    cleanup();

    if (isShapeInlineText && resolvedShapeTextHostNode && originalHostElement) {
      applyRuntimeElement(portal, { element: originalHostElement });
      portal.scene.staticForegroundLayer.batchDraw();
      portal.selection.setSelection([resolvedShapeTextHostNode]);
      portal.selection.setFocusedNode(resolvedShapeTextHostNode);
      return;
    }

    if (args.isNew) {
      activeNode.destroy();
      portal.scene.staticForegroundLayer.batchDraw();
      portal.selection.clear();
      return;
    }

    activeNode.visible(true);
    portal.scene.staticForegroundLayer.batchDraw();
  };

  const stopKeyPropagation = (event: KeyboardEvent) => {
    event.stopPropagation();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    event.stopPropagation();

    if (event.key === "Escape") {
      event.preventDefault();
      textarea.blur();
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      const selectionStart = textarea.selectionStart ?? textarea.value.length;
      const selectionEnd = textarea.selectionEnd ?? selectionStart;
      textarea.setRangeText("\n", selectionStart, selectionEnd, "end");
      autoGrow();
    }
  };

  textarea.addEventListener("input", autoGrow);
  textarea.addEventListener("blur", commit, { once: true });
  textarea.addEventListener("keydown", onKeyDown);
  textarea.addEventListener("keyup", stopKeyPropagation);

  portal.scene.stage.container().appendChild(textarea);
  autoGrow();
  textarea.focus();
  textarea.select();
}
