import type { IPlugin } from "@vibecanvas/runtime";
import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import Circle from "lucide-static/icons/circle.svg?raw";
import Diamond from "lucide-static/icons/diamond.svg?raw";
import Square from "lucide-static/icons/square.svg?raw";
import { DEFAULT_STROKE_WIDTHS } from "../../components/SelectionStyleMenu/types";
import {
  fnCreateShape2dElement,
  fnGetShape2dDraftBounds,
  fnGetShape2dElementTypeFromTool,
  type TShape2dToolId,
} from "../../core/fn.shape2d";
import type { IRuntimeConfig, IRuntimeHooks, IRuntimeServices } from "../../types";
import {
  DEFAULT_ATTACHED_TEXT_ALIGN,
  DEFAULT_ATTACHED_TEXT_VERTICAL_ALIGN,
  TEXT_FONT_SIZE_TOKEN_BY_PRESET,
} from "../text/CONSTANTS";

const DEFAULT_FILL = "@base/300";
const DEFAULT_STROKE_WIDTH = "@stroke-width/none";

export function fxGetShape2dToolDefaults() {
  return {
    fillColor: DEFAULT_FILL,
    strokeWidth: DEFAULT_STROKE_WIDTH,
    opacity: 1,
  };
}

export function fxApplyRememberedShape2dToolStyle(args: {
  element: TElement;
  rememberedStyle: {
    fillColor?: string;
    strokeColor?: string;
    strokeWidth?: string;
    opacity?: number;
  };
}) {
  const next = {
    ...args.element,
    style: {
      ...args.element.style,
      backgroundColor: args.rememberedStyle.fillColor ?? DEFAULT_FILL,
      strokeWidth: args.rememberedStyle.strokeWidth ?? DEFAULT_STROKE_WIDTH,
      opacity: args.rememberedStyle.opacity ?? 1,
    },
  } satisfies TElement;
  if (args.rememberedStyle.strokeColor !== undefined) {
    next.style.strokeColor = args.rememberedStyle.strokeColor;
  }
  return next;
}

function nextZIndex(document: ReturnType<IRuntimeServices["crdt"]["doc"]>) {
  return `z${String(
    Object.keys(document.elements).length + Object.keys(document.groups).length,
  ).padStart(8, "0")}`;
}

function recordElement(
  services: Pick<IRuntimeServices, "crdt" | "history" | "selection">,
  element: TElement,
  label: string,
) {
  const result = services.crdt.build().patchElement(element.id, element).commit();
  services.history.record({
    label,
    undo: () => services.crdt.applyOps({ ops: result.undoOps }),
    redo: () => services.crdt.applyOps({ ops: result.redoOps }),
  });
  services.selection.select({ kind: "element", id: element.id });
}

function makeId(document: Document, prefix: string) {
  return document.defaultView?.crypto.randomUUID()
    ?? `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function createShape2dPlugin():
IPlugin<IRuntimeServices, IRuntimeHooks, IRuntimeConfig> {
  return {
    name: "shape2d",
    apply(ctx) {
      const crdt = ctx.services.require("crdt");
      const element = ctx.services.require("element");
      const history = ctx.services.require("history");
      const scene = ctx.services.require("scene");
      const selection = ctx.services.require("selection");
      const theme = ctx.services.require("theme");
      const tool = ctx.services.require("tool");
      const cleanups: Array<() => void> = [];

      cleanups.push(element.registerElement({
        id: "shape2d",
        matchesElement: (candidate) => {
          return candidate.data.type === "rect"
            || candidate.data.type === "diamond"
            || candidate.data.type === "ellipse";
        },
        getSelectionStyleMenu: () => ({
          sections: {
            showFillPicker: true,
            showStrokeColorPicker: true,
            showStrokeWidthPicker: true,
            showOpacityPicker: true,
            showTextPickers: true,
          },
          values: {
            fillColor: DEFAULT_FILL,
            strokeWidth: DEFAULT_STROKE_WIDTH,
            opacity: 1,
            fontFamily: "Arial, sans-serif",
            fontSize: TEXT_FONT_SIZE_TOKEN_BY_PRESET.M,
            textAlign: DEFAULT_ATTACHED_TEXT_ALIGN,
            verticalAlign: DEFAULT_ATTACHED_TEXT_VERTICAL_ALIGN,
          },
          strokeWidthOptions: [...DEFAULT_STROKE_WIDTHS],
        }),
      }));

      const definitions: Array<{
        id: TShape2dToolId;
        label: string;
        icon: string;
        shortcuts: string[];
        priority: number;
      }> = [
        { id: "rect", label: "Rectangle", icon: Square, shortcuts: ["3", "r"], priority: 30 },
        { id: "diamond", label: "Diamond", icon: Diamond, shortcuts: ["5", "d"], priority: 50 },
        { id: "ellipse", label: "Ellipse", icon: Circle, shortcuts: ["4", "o"], priority: 40 },
      ];

      for (const definition of definitions) {
        cleanups.push(tool.registerTool({
          ...definition,
          behavior: { type: "mode", mode: "draw-create" },
          createSession: (event) => {
            const sessionId = `create-${definition.id}-${event.pointerId}`;
            scene.product.interactions.beginCreation(event, {
              constrainDraft: (draft) => {
                if (!draft.current.modifiers.shift) {
                  return {};
                }
                const bounds = fnGetShape2dDraftBounds({
                  origin: draft.start.world,
                  point: draft.current.world,
                  preserveRatio: true,
                });
                return {
                  worldBounds: {
                    minX: bounds.x,
                    minY: bounds.y,
                    maxX: bounds.x + bounds.width,
                    maxY: bounds.y + bounds.height,
                  },
                };
              },
              onCommit: (commit) => {
                tool.completeSession(sessionId);
                const remembered = theme.getRememberedStyle(definition.id);
                const width = commit.belowThreshold
                  ? 100
                  : commit.worldBounds.maxX - commit.worldBounds.minX;
                const height = commit.belowThreshold
                  ? 100
                  : commit.worldBounds.maxY - commit.worldBounds.minY;
                const x = commit.belowThreshold
                  ? commit.start.world.x - width / 2
                  : commit.worldBounds.minX;
                const y = commit.belowThreshold
                  ? commit.start.world.y - height / 2
                  : commit.worldBounds.minY;
                const timestamp = Date.now();
                const created = fnCreateShape2dElement({
                  id: makeId(scene.container.ownerDocument, definition.id),
                  type: fnGetShape2dElementTypeFromTool(definition.id),
                  x,
                  y,
                  rotation: 0,
                  width,
                  height,
                  createdAt: timestamp,
                  updatedAt: timestamp,
                  parentGroupId: null,
                  zIndex: nextZIndex(crdt.doc()),
                  style: {
                    backgroundColor: remembered.fillColor ?? DEFAULT_FILL,
                    strokeColor: remembered.strokeColor,
                    strokeWidth: remembered.strokeWidth ?? DEFAULT_STROKE_WIDTH,
                    opacity: remembered.opacity ?? 1,
                  },
                });
                recordElement(
                  { crdt, history, selection },
                  created,
                  `Create ${definition.label.toLowerCase()}`,
                );
              },
              onCancel: () => {
                tool.completeSession(sessionId);
              },
            });
            return {
              id: sessionId,
              cancel: () => scene.product.interactions.cancel(),
            };
          },
        }));
      }

      ctx.hooks.destroy.tap(() => {
        for (const cleanup of cleanups.splice(0).reverse()) {
          cleanup();
        }
      });
    },
  };
}
