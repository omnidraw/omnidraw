import type { IPlugin } from "@vibecanvas/runtime";
import type {
  TCanvasInputEvent,
  TCanvasInputPointerEvent,
} from "../../engine/input/typed";
import {
  fnCanvasTargetKey,
  fnCanvasTargetsEqual,
} from "../../semantic/fn.target";
import type { TCanvasSemanticHitPart } from "../../semantic/typed";
import type {
  IRuntimeConfig,
  IRuntimeHooks,
  IRuntimeServices,
  TElementPointerEvent,
} from "../../types";

const DOUBLE_CLICK_DELAY_MS = 350;
const DOUBLE_CLICK_DISTANCE_PX = 6;
const CLICK_MAX_DURATION_MS = 750;
const CLICK_MAX_MOVEMENT_PX = 6;

type TLastClick = {
  targetKey: string;
  pointerType: TCanvasInputPointerEvent["pointerType"];
  timeStamp: number;
  viewport: { x: number; y: number };
};

type TClickCandidate = {
  pointerId: number;
  pointerType: TCanvasInputPointerEvent["pointerType"];
  button: number;
  targetKey: string;
  timeStamp: number;
  viewport: { x: number; y: number };
};

function isEditableOrHostedTarget(
  document: Document,
  target: EventTarget | null,
): boolean {
  const HTMLElementConstructor = document.defaultView?.HTMLElement;
  if (
    HTMLElementConstructor === undefined
    || !(target instanceof HTMLElementConstructor)
  ) {
    return false;
  }
  return target.matches("input, textarea, select")
    || target.isContentEditable
    || target.closest('[contenteditable="true"]') !== null
    || target.closest('[data-hosted-widget-root="true"]') !== null;
}

function toElementEvent(
  event: TCanvasInputPointerEvent,
): TElementPointerEvent | null {
  return event.hit === null
    ? null
    : {
        ...event,
        hit: event.hit,
      };
}

function isWidgetFrameControl(part: TCanvasSemanticHitPart): boolean {
  if (
    part === "widget-minimize"
    || part === "widget-restore"
    || part === "widget-fullscreen"
  ) {
    return true;
  }
  return typeof part === "object" && part.value.startsWith("control:");
}

function isDoubleClick(
  previous: TLastClick | null,
  current: TLastClick,
): boolean {
  if (
    previous === null
    || previous.targetKey !== current.targetKey
    || previous.pointerType !== current.pointerType
    || current.timeStamp < previous.timeStamp
    || current.timeStamp - previous.timeStamp > DOUBLE_CLICK_DELAY_MS
  ) {
    return false;
  }
  return Math.hypot(
    current.viewport.x - previous.viewport.x,
    current.viewport.y - previous.viewport.y,
  ) <= DOUBLE_CLICK_DISTANCE_PX;
}

function pointerDistance(
  start: Readonly<{ x: number; y: number }>,
  end: Readonly<{ x: number; y: number }>,
): number {
  return Math.hypot(end.x - start.x, end.y - start.y);
}

function clickCandidate(
  event: TCanvasInputPointerEvent,
): TClickCandidate | null {
  if (event.button !== 0 || event.hit === null) {
    return null;
  }
  return {
    pointerId: event.pointerId,
    pointerType: event.pointerType,
    button: event.button,
    targetKey: fnCanvasTargetKey(event.hit.target),
    timeStamp: event.timeStamp,
    viewport: { ...event.viewport },
  };
}

function completesClick(
  candidate: TClickCandidate | undefined,
  event: TCanvasInputPointerEvent,
): boolean {
  if (
    candidate === undefined
    || event.hit === null
    || event.pointerId !== candidate.pointerId
    || event.pointerType !== candidate.pointerType
    || event.button !== candidate.button
    || event.timeStamp < candidate.timeStamp
    || event.timeStamp - candidate.timeStamp > CLICK_MAX_DURATION_MS
    || fnCanvasTargetKey(event.hit.target) !== candidate.targetKey
  ) {
    return false;
  }
  return pointerDistance(candidate.viewport, event.viewport)
    <= CLICK_MAX_MOVEMENT_PX;
}

/**
 * Bridges normalized engine input into the legacy runtime hook shell.
 */
export function createEventListenerPlugin(): IPlugin<
  IRuntimeServices,
  IRuntimeHooks,
  IRuntimeConfig
> {
  return {
    name: "event-listener",
    apply(ctx) {
      const scene = ctx.services.require("scene");
      const container = scene.container;
      let unsubscribeInput: (() => void) | null = null;
      let lastClick: TLastClick | null = null;
      const clickCandidates = new Map<number, TClickCandidate>();
      let previousTabIndex: string | null = null;
      let previousOutline = "";

      const onKeyDown = (event: KeyboardEvent) => {
        if (isEditableOrHostedTarget(container.ownerDocument, event.target)) {
          return;
        }
        ctx.hooks.keydown.call(event);
      };
      const onKeyUp = (event: KeyboardEvent) => {
        if (isEditableOrHostedTarget(container.ownerDocument, event.target)) {
          return;
        }
        ctx.hooks.keyup.call(event);
      };

      const onInput = (event: TCanvasInputEvent) => {
        if (event.type === "wheel") {
          ctx.hooks.pointerWheel.call(event);
          return {
            handled: true,
            preventDefault: true,
          };
        }
        if (event.type === "key-down" || event.type === "key-up") {
          return;
        }
        if (!("pointerId" in event)) {
          return;
        }

        const directWidgetHit = event.hit === null
          ? null
          : scene.input.hitTestViewport({
              point: event.viewport,
              options: {
                kinds: ["widget-frame"],
                mode: "topmost",
              },
            }).find((hit) => {
              return fnCanvasTargetsEqual(hit.target, event.hit?.target ?? null)
                && isWidgetFrameControl(hit.part);
            }) ?? null;
        const pointerEvent: TCanvasInputPointerEvent = directWidgetHit === null
          ? event
          : { ...event, hit: directWidgetHit };
        const elementEvent = toElementEvent(pointerEvent);
        switch (event.type) {
          case "pointer-down": {
            const candidate = clickCandidate(pointerEvent);
            if (candidate === null) {
              clickCandidates.delete(pointerEvent.pointerId);
              lastClick = null;
            } else {
              clickCandidates.set(pointerEvent.pointerId, candidate);
            }
            ctx.hooks.pointerDown.call(pointerEvent);
            const handled = elementEvent === null
              ? undefined
              : ctx.hooks.elementPointerDown.call(elementEvent);
            return handled === true
              ? {
                  handled: true,
                  stopPropagation: true,
                }
              : undefined;
          }
          case "pointer-up": {
            ctx.hooks.pointerUp.call(pointerEvent);
            const candidate = clickCandidates.get(pointerEvent.pointerId);
            clickCandidates.delete(pointerEvent.pointerId);
            if (
              elementEvent === null
              || !completesClick(candidate, pointerEvent)
            ) {
              lastClick = null;
              return;
            }
            ctx.hooks.elementPointerClick.call(elementEvent);
            const currentClick: TLastClick = {
              targetKey: fnCanvasTargetKey(elementEvent.hit.target),
              pointerType: event.pointerType,
              timeStamp: event.timeStamp,
              viewport: { ...event.viewport },
            };
            if (isDoubleClick(lastClick, currentClick)) {
              ctx.hooks.elementPointerDoubleClick.call(elementEvent);
              lastClick = null;
            } else {
              lastClick = currentClick;
            }
            return;
          }
          case "pointer-move": {
            const candidate = clickCandidates.get(pointerEvent.pointerId);
            if (
              candidate !== undefined
              && pointerDistance(candidate.viewport, pointerEvent.viewport)
                > CLICK_MAX_MOVEMENT_PX
            ) {
              clickCandidates.delete(pointerEvent.pointerId);
              lastClick = null;
            }
            ctx.hooks.pointerMove.call(pointerEvent);
            return;
          }
          case "pointer-enter":
            ctx.hooks.pointerOver.call(pointerEvent);
            return;
          case "pointer-leave":
            ctx.hooks.pointerOut.call(pointerEvent);
            return;
          case "pointer-cancel":
            clickCandidates.delete(pointerEvent.pointerId);
            lastClick = null;
            ctx.hooks.pointerCancel.call(pointerEvent);
            return;
        }
      };

      ctx.hooks.init.tap(() => {
        previousTabIndex = container.getAttribute("tabindex");
        previousOutline = container.style.outline;
        container.tabIndex = 0;
        container.style.outline = "none";
        container.addEventListener("keydown", onKeyDown);
        container.addEventListener("keyup", onKeyUp);
        unsubscribeInput = scene.input.subscribe(onInput);
        scene.input.focus();
        container.focus();
      });

      ctx.hooks.destroy.tap(() => {
        unsubscribeInput?.();
        unsubscribeInput = null;
        clickCandidates.clear();
        lastClick = null;
        scene.input.blur();
        container.removeEventListener("keydown", onKeyDown);
        container.removeEventListener("keyup", onKeyUp);
        if (previousTabIndex === null) {
          container.removeAttribute("tabindex");
        } else {
          container.setAttribute("tabindex", previousTabIndex);
        }
        container.style.outline = previousOutline;
      });
    },
  };
}
