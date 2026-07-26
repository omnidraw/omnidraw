import type { IPlugin } from "@vibecanvas/runtime";
import type {
  TBinding,
} from "@vibecanvas/service-automerge/types/canvas-doc.types";
import ArrowRight from "lucide-static/icons/arrow-right.svg?raw";
import Minus from "lucide-static/icons/minus.svg?raw";
import { DEFAULT_STROKE_WIDTHS } from "../../components/SelectionStyleMenu/types";
import type { TCanvasTarget } from "../../semantic/typed";
import type { IRuntimeConfig, IRuntimeHooks, IRuntimeServices } from "../../types";
import {
  DEFAULT_OPACITY,
  DEFAULT_STROKE_COLOR_TOKEN,
  DEFAULT_STROKE_WIDTH_TOKEN,
  type TShape1dTool,
} from "./CONSTANTS";
import { fnShape1dBinding } from "./fn.binding";
import { fnCreateDraftElement } from "./fn.draft";

function nextZIndex(services: Pick<IRuntimeServices, "crdt">) {
  const document = services.crdt.doc();
  return `z${String(
    Object.keys(document.elements).length + Object.keys(document.groups).length,
  ).padStart(8, "0")}`;
}

function createId(document: Document) {
  return document.defaultView?.crypto.randomUUID()
    ?? `shape1d-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function createShape1dPlugin():
IPlugin<IRuntimeServices, IRuntimeHooks, IRuntimeConfig> {
  return {
    name: "shape1d",
    apply(ctx) {
      const crdt = ctx.services.require("crdt");
      const element = ctx.services.require("element");
      const history = ctx.services.require("history");
      const scene = ctx.services.require("scene");
      const selection = ctx.services.require("selection");
      const theme = ctx.services.require("theme");
      const tool = ctx.services.require("tool");
      const cleanups: Array<() => void> = [];

      const bindableTarget = (
        target: TCanvasTarget | undefined,
        excludedElementId?: string,
      ): TCanvasTarget | null => {
        if (
          target?.kind !== "element"
          || target.id === excludedElementId
        ) {
          return null;
        }
        const candidate = crdt.doc().elements[target.id];
        return candidate === undefined || candidate.locked ? null : target;
      };
      const boundEndpoint = (
        target: TCanvasTarget | null,
        worldPoint: { x: number; y: number },
      ): {
        point: { x: number; y: number };
        binding: TBinding | null;
      } => {
        if (target === null || target.kind !== "element") {
          return { point: worldPoint, binding: null };
        }
        const bounds = scene.product.geometry.worldBounds({ target });
        if (bounds === null) {
          return { point: worldPoint, binding: null };
        }
        const point = scene.product.geometry.nearestPoint(
          { target },
          worldPoint,
        )?.point ?? worldPoint;
        return {
          point,
          binding: fnShape1dBinding({
            targetId: target.id,
            worldPoint: point,
            worldBounds: bounds,
          }),
        };
      };

      cleanups.push(element.registerElement({
        id: "shape1d",
        matchesElement: (candidate) => {
          return candidate.data.type === "line"
            || candidate.data.type === "arrow";
        },
        getSelectionStyleMenu: ({ element: candidate }) => ({
          sections: {
            showStrokeColorPicker: true,
            showStrokeWidthPicker: true,
            showOpacityPicker: true,
            showLineTypePicker: true,
            showStartCapPicker: candidate?.data.type === "arrow",
            showEndCapPicker: candidate?.data.type === "arrow",
          },
          values: {
            strokeColor: DEFAULT_STROKE_COLOR_TOKEN,
            strokeWidth: DEFAULT_STROKE_WIDTH_TOKEN,
            opacity: DEFAULT_OPACITY,
            lineType: "straight",
            startCap: "none",
            endCap: "arrow",
          },
          strokeWidthOptions: [...DEFAULT_STROKE_WIDTHS],
        }),
      }));

      const definitions: Array<{
        id: TShape1dTool;
        label: string;
        icon: string;
        shortcuts: string[];
        priority: number;
      }> = [
        { id: "line", label: "Line", icon: Minus, shortcuts: ["6", "l"], priority: 60 },
        { id: "arrow", label: "Arrow", icon: ArrowRight, shortcuts: ["7", "a"], priority: 70 },
      ];

      for (const definition of definitions) {
        cleanups.push(tool.registerTool({
          ...definition,
          behavior: { type: "mode", mode: "draw-create" },
          createSession: (event) => {
            const sessionId = `create-${definition.id}-${event.pointerId}`;
            const source = bindableTarget(event.hit?.target);
            scene.product.interactions.beginConnector(event, {
              ...(source === null ? {} : { source }),
              acceptCandidate: (hit) => {
                return bindableTarget(hit.target) !== null;
              },
              preview: {
                routing: "straight",
                stroke: {
                  color: { r: 0.1, g: 0.1, b: 0.1, a: 1 },
                  width: 2,
                },
              },
              onCommit: (commit) => {
                tool.completeSession(sessionId);
                if (commit.belowThreshold) {
                  return;
                }
                const startTarget = source;
                const endTarget = bindableTarget(commit.candidate?.target);
                const start = boundEndpoint(
                  startTarget,
                  commit.route?.pathStart ?? commit.start.world,
                );
                const end = boundEndpoint(
                  endTarget,
                  commit.route?.pathEnd ?? commit.current.world,
                );
                const now = Date.now();
                const created = fnCreateDraftElement({
                  activeTool: definition.id,
                  draftElementId: createId(scene.container.ownerDocument),
                  draftStartPoint: [
                    start.point.x,
                    start.point.y,
                  ],
                  draftCurrentPoint: [
                    end.point.x,
                    end.point.y,
                  ],
                  createId: () => createId(scene.container.ownerDocument),
                  now: () => now,
                  startBinding: start.binding,
                  endBinding: end.binding,
                  rememberedStyle: theme.getRememberedStyle(definition.id),
                });
                if (created === null) {
                  return;
                }
                created.zIndex = nextZIndex({ crdt });
                const result = crdt.build()
                  .patchElement(created.id, created)
                  .commit();
                history.record({
                  label: `Create ${definition.label.toLowerCase()}`,
                  undo: () => crdt.applyOps({ ops: result.undoOps }),
                  redo: () => crdt.applyOps({ ops: result.redoOps }),
                });
                selection.select({ kind: "element", id: created.id });
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
