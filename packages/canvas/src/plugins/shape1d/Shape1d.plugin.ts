import type { IPlugin } from "@vibecanvas/runtime";
import type {
  TBinding,
  TElement,
} from "@vibecanvas/service-automerge/types/canvas-doc.types";
import ArrowRight from "lucide-static/icons/arrow-right.svg?raw";
import Minus from "lucide-static/icons/minus.svg?raw";
import { DEFAULT_STROKE_WIDTHS } from "../../components/SelectionStyleMenu/types";
import type { TCanvasProductTransientOwner } from "../../engine/product-runtime/typed";
import type { TCanvasTarget } from "../../semantic/typed";
import { fnCanvasActiveSessionDependencies } from "../../services/active-session/fn.dependencies";
import type { IRuntimeConfig, IRuntimeHooks, IRuntimeServices } from "../../types";
import {
  DEFAULT_OPACITY,
  DEFAULT_STROKE_COLOR_TOKEN,
  DEFAULT_STROKE_WIDTH_TOKEN,
  type TShape1dTool,
} from "./CONSTANTS";
import { fnShape1dBinding } from "./fn.binding";
import { fnCreateDraftElement } from "./fn.draft";
import {
  fnBeginShape1dPointEdit,
  fnCanCommitShape1dPointEdit,
  fnMoveShape1dPoint,
  fnShape1dEditHandles,
  fnShape1dElementWithPoints,
  type TShape1dEditHandle,
} from "./fn.point-edit";

const POINT_EDIT_ELEMENT_DEPENDENCY_FIELDS = [
  "x",
  "y",
  "rotation",
  "scaleX",
  "scaleY",
  "parentGroupId",
  "data",
  "bindings",
  "locked",
] as const;

const POINT_EDIT_GROUP_DEPENDENCY_FIELDS = [
  "parentGroupId",
  "locked",
] as const;

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
      const activeSession = ctx.services.require("activeSession");
      const crdt = ctx.services.require("crdt");
      const element = ctx.services.require("element");
      const history = ctx.services.require("history");
      const scene = ctx.services.require("scene");
      const selection = ctx.services.require("selection");
      const theme = ctx.services.require("theme");
      const tool = ctx.services.require("tool");
      const cleanups: Array<() => void> = [];
      let pointEdit: {
        activeSessionId: string;
        element: TElement;
        handles: TCanvasProductTransientOwner;
        preview: TCanvasProductTransientOwner;
        drag: {
          pointerId: number;
          pointIndex: number;
          points: [number, number][];
          startBinding: TBinding | null;
          endBinding: TBinding | null;
        } | null;
      } | null = null;

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

      const exitPointEdit = () => {
        const active = pointEdit;
        if (active === null) {
          return;
        }
        pointEdit = null;
        activeSession.complete(active.activeSessionId);
        active.handles.destroy();
        active.preview.destroy();
      };
      const handleFromHit = (
        handles: readonly TShape1dEditHandle[],
        handleId: string | undefined,
      ) => {
        if (handleId === undefined) {
          return null;
        }
        return handles.find((handle) => handleId.includes(handle.id)) ?? null;
      };
      const showPointEdit = (
        active: NonNullable<typeof pointEdit>,
        points: readonly (readonly [number, number])[],
      ) => {
        const target = { kind: "element" as const, id: active.element.id };
        const handles = fnShape1dEditHandles(points).flatMap((handle) => {
          const world = scene.product.geometry.localToWorld(
            { target },
            { x: handle.point[0], y: handle.point[1] },
          );
          if (world === null) {
            return [];
          }
          const viewport = scene.product.geometry.worldToViewport(world);
          return [{
            id: handle.id,
            parentId: null,
            orderKey: handle.insert ? "0" : "1",
            kind: "ellipse" as const,
            size: {
              width: handle.insert ? 8 : 12,
              height: handle.insert ? 8 : 12,
            },
            transform: {
              position: {
                x: viewport.x - (handle.insert ? 4 : 6),
                y: viewport.y - (handle.insert ? 4 : 6),
              },
            },
            fill: handle.insert
              ? { r: 0.39, g: 0.4, b: 0.95, a: 0.55 }
              : { r: 1, g: 1, b: 1, a: 1 },
            stroke: {
              color: { r: 0.31, g: 0.27, b: 0.9, a: 1 },
              width: 1.5,
            },
          }];
        });
        active.handles.replace({
          band: "screen-overlay",
          hitTest: "enabled",
          nodes: handles,
        });
      };
      const showPointPreview = (
        active: NonNullable<typeof pointEdit>,
        points: readonly (readonly [number, number])[],
      ) => {
        const target = { kind: "element" as const, id: active.element.id };
        const world = points.flatMap((point) => {
          const value = scene.product.geometry.localToWorld(
            { target },
            { x: point[0], y: point[1] },
          );
          return value === null ? [] : [value];
        });
        active.preview.replace({
          band: "world-overlay",
          hitTest: "none",
          nodes: world.length === 0 ? [] : [{
            id: "path",
            parentId: null,
            orderKey: "0",
            kind: "path",
            path: world.map((point, index) => ({
              type: index === 0 ? "M" as const : "L" as const,
              to: point,
            })),
            stroke: {
              color: { r: 0.31, g: 0.27, b: 0.9, a: 0.9 },
              width: 2,
            },
            pointerEvents: "none",
          }],
        });
        showPointEdit(active, points);
      };
      const enterPointEdit = (candidate: TElement) => {
        if (
          candidate.data.type !== "line"
          && candidate.data.type !== "arrow"
        ) {
          return false;
        }
        exitPointEdit();
        const ownerId = `shape1d-edit:${candidate.id}`;
        const activeSessionId = `shape1d-point-edit:${candidate.id}`;
        const target = { kind: "element" as const, id: candidate.id };
        pointEdit = {
          activeSessionId,
          element: structuredClone(candidate),
          handles: scene.product.transients.createOwner({
            ownerId: `${ownerId}:handles`,
            target,
          }),
          preview: scene.product.transients.createOwner({
            ownerId: `${ownerId}:preview`,
          }),
          drag: null,
        };
        activeSession.register({
          id: activeSessionId,
          kind: "line-point-edit",
          startedAtRevision: crdt.revision,
          dependencies: fnCanvasActiveSessionDependencies({
            document: crdt.doc(),
            targets: [target],
            elementFields: POINT_EDIT_ELEMENT_DEPENDENCY_FIELDS,
            groupFields: POINT_EDIT_GROUP_DEPENDENCY_FIELDS,
          }),
          cancel: exitPointEdit,
        });
        showPointEdit(pointEdit, candidate.data.points);
        return true;
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
        getTransformPolicy: () => ({
          handles: ["move", "rotate", "resize-ne", "resize-sw"],
          allowFlip: true,
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

      cleanups.push(ctx.hooks.elementPointerDoubleClick.tap((event) => {
        if (event.hit.target.kind !== "element") {
          return false;
        }
        const candidate = crdt.doc().elements[event.hit.target.id];
        return candidate !== undefined && enterPointEdit(candidate);
      }));
      cleanups.push(ctx.hooks.pointerDown.tap((event) => {
        const active = pointEdit;
        if (
          active === null
          || event.hit?.transient?.ownerId !== active.handles.id
          || (active.element.data.type !== "line"
            && active.element.data.type !== "arrow")
        ) {
          return;
        }
        const handles = fnShape1dEditHandles(active.element.data.points);
        const handle = handleFromHit(handles, event.hit.transient.handleId);
        if (handle === null) {
          return;
        }
        const begin = fnBeginShape1dPointEdit({
          points: active.element.data.points,
          handle,
        });
        active.drag = {
          pointerId: event.pointerId,
          pointIndex: begin.pointIndex,
          points: begin.points,
          startBinding: active.element.data.startBinding,
          endBinding: active.element.data.endBinding,
        };
        showPointPreview(active, begin.points);
      }));
      cleanups.push(ctx.hooks.pointerMove.tap((event) => {
        const active = pointEdit;
        if (
          active?.drag === null
          || active === null
          || active.drag.pointerId !== event.pointerId
        ) {
          return;
        }
        const isStart = active.drag.pointIndex === 0;
        const isEnd = active.drag.pointIndex === active.drag.points.length - 1;
        const candidate = isStart || isEnd
          ? bindableTarget(
              scene.input.hitTestWorld({ point: event.world })[0]?.target,
              active.element.id,
            )
          : null;
        const endpoint = isStart || isEnd
          ? boundEndpoint(candidate, event.world)
          : { point: event.world, binding: null };
        const local = scene.product.geometry.worldToLocal(
          { target: { kind: "element", id: active.element.id } },
          endpoint.point,
        );
        if (local === null) {
          return;
        }
        active.drag.points = fnMoveShape1dPoint({
          points: active.drag.points,
          pointIndex: active.drag.pointIndex,
          point: local,
        });
        if (isStart) {
          active.drag.startBinding = endpoint.binding;
        }
        if (isEnd) {
          active.drag.endBinding = endpoint.binding;
        }
        showPointPreview(active, active.drag.points);
      }));
      cleanups.push(ctx.hooks.pointerUp.tap((event) => {
        const active = pointEdit;
        if (
          active?.drag === null
          || active === null
          || active.drag.pointerId !== event.pointerId
        ) {
          return;
        }
        const current = crdt.doc().elements[active.element.id];
        if (!fnCanCommitShape1dPointEdit(active.element, current)) {
          exitPointEdit();
          return;
        }
        const next = fnShape1dElementWithPoints({
          element: current,
          points: active.drag.points,
          startBinding: active.drag.startBinding,
          endBinding: active.drag.endBinding,
          updatedAt: Date.now(),
        });
        if (next === null) {
          exitPointEdit();
          return;
        }
        const result = crdt.build().patchElement(next.id, next).commit();
        history.record({
          label: "Edit connector points",
          undo: () => crdt.applyOps({ ops: result.undoOps }),
          redo: () => crdt.applyOps({ ops: result.redoOps }),
        });
        active.element = structuredClone(next);
        active.drag = null;
        active.preview.clear();
        showPointEdit(active, next.data.type === "line"
          || next.data.type === "arrow" ? next.data.points : []);
      }));
      cleanups.push(ctx.hooks.pointerCancel.tap(() => {
        if (pointEdit !== null) {
          pointEdit.drag = null;
          pointEdit.preview.clear();
          if (
            pointEdit.element.data.type === "line"
            || pointEdit.element.data.type === "arrow"
          ) {
            showPointEdit(pointEdit, pointEdit.element.data.points);
          }
        }
      }));
      cleanups.push(ctx.hooks.keydown.tap((event) => {
        if (event.key === "Escape") {
          exitPointEdit();
        }
      }));
      cleanups.push(selection.hooks.change.tap((snapshot) => {
        if (
          pointEdit !== null
          && !snapshot.selection.some((target) => {
            return target.kind === "element"
              && target.id === pointEdit?.element.id;
          })
        ) {
          exitPointEdit();
        }
      }));

      ctx.hooks.destroy.tap(() => {
        exitPointEdit();
        for (const cleanup of cleanups.splice(0).reverse()) {
          cleanup();
        }
      });
    },
  };
}
