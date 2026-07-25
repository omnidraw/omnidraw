import type { IPlugin } from "@vibecanvas/runtime";
import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import Pencil from "lucide-static/icons/pencil.svg?raw";
import { PEN_STROKE_WIDTHS } from "../../components/SelectionStyleMenu/types";
import type { IRuntimeConfig, IRuntimeHooks, IRuntimeServices } from "../../types";
import {
  DEFAULT_OPACITY,
  DEFAULT_STROKE_WIDTH_TOKEN,
} from "./CONSTANTS";
import { fnCreatePenDataFromStrokePoints } from "./fn.math";

const DEFAULT_PEN_COLOR_TOKEN = "@base/900";

function createId(document: Document) {
  return document.defaultView?.crypto.randomUUID()
    ?? `pen-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function nextZIndex(services: Pick<IRuntimeServices, "crdt">) {
  const document = services.crdt.doc();
  return `z${String(
    Object.keys(document.elements).length + Object.keys(document.groups).length,
  ).padStart(8, "0")}`;
}

export function createPenPlugin():
IPlugin<IRuntimeServices, IRuntimeHooks, IRuntimeConfig> {
  return {
    name: "pen",
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
        id: "pen",
        matchesElement: (candidate) => candidate.data.type === "pen",
        getSelectionStyleMenu: () => ({
          sections: {
            showFillPicker: true,
            showStrokeWidthPicker: true,
            showOpacityPicker: true,
          },
          values: {
            fillColor: DEFAULT_PEN_COLOR_TOKEN,
            strokeWidth: DEFAULT_STROKE_WIDTH_TOKEN,
            opacity: DEFAULT_OPACITY,
          },
          strokeWidthOptions: [...PEN_STROKE_WIDTHS],
        }),
      }));

      cleanups.push(tool.registerTool({
        id: "pen",
        label: "Pen",
        icon: Pencil,
        shortcuts: ["p"],
        priority: 80,
        behavior: { type: "mode", mode: "draw-create" },
        createSession: (event) => {
          scene.product.interactions.beginStroke(event, {
            minDistanceViewport: 0.5,
            maxSamples: 10_000,
            onCommit: (stroke) => {
              const data = fnCreatePenDataFromStrokePoints({
                points: stroke.samples.map((sample) => ({
                  x: sample.world.x,
                  y: sample.world.y,
                  pressure: sample.pressure,
                })),
              });
              if (data === null) {
                return;
              }
              const now = Date.now();
              const remembered = theme.getRememberedStyle("pen");
              const created: TElement = {
                id: createId(scene.container.ownerDocument),
                x: data.x,
                y: data.y,
                rotation: 0,
                scaleX: 1,
                scaleY: 1,
                zIndex: nextZIndex({ crdt }),
                parentGroupId: null,
                bindings: [],
                locked: false,
                createdAt: now,
                updatedAt: now,
                data,
                style: {
                  backgroundColor: remembered.strokeColor
                    ?? DEFAULT_PEN_COLOR_TOKEN,
                  opacity: remembered.opacity ?? DEFAULT_OPACITY,
                  strokeWidth: remembered.strokeWidth
                    ?? DEFAULT_STROKE_WIDTH_TOKEN,
                },
              };
              const result = crdt.build()
                .patchElement(created.id, created)
                .commit();
              history.record({
                label: "Create pen stroke",
                undo: () => crdt.applyOps({ ops: result.undoOps }),
                redo: () => crdt.applyOps({ ops: result.redoOps }),
              });
              selection.select({ kind: "element", id: created.id });
            },
          });
          return {
            id: `create-pen-${event.pointerId}`,
            cancel: () => scene.product.interactions.cancel(),
          };
        },
      }));

      ctx.hooks.destroy.tap(() => {
        for (const cleanup of cleanups.splice(0).reverse()) {
          cleanup();
        }
      });
    },
  };
}
