import type { IPlugin } from "@vibecanvas/runtime";
import type {
  TCanvasInputClickEvent,
  TCanvasInputEvent,
  TCanvasInputPointerEvent,
} from "../../engine/input/typed";
import type {
  IRuntimeConfig,
  IRuntimeHooks,
  IRuntimeServices,
  TElementPointerEvent,
} from "../../types";

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
      let unsubscribeClicks: (() => void) | null = null;
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

        const pointerEvent: TCanvasInputPointerEvent = event;
        const elementEvent = toElementEvent(pointerEvent);
        switch (event.type) {
          case "pointer-down": {
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
            return;
          }
          case "pointer-move": {
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
            ctx.hooks.pointerCancel.call(pointerEvent);
            return;
        }
      };

      const onClick = (event: TCanvasInputClickEvent) => {
        if (event.hit === null) {
          return;
        }
        const elementEvent: TElementPointerEvent = {
          ...event,
          type: "pointer-up",
          buttons: 0,
          pressure: 0,
          tilt: { x: 0, y: 0 },
          deltaViewport: { x: 0, y: 0 },
          deltaWorld: { x: 0, y: 0 },
          hit: event.hit,
        };
        if (event.type === "double-click") {
          ctx.hooks.elementPointerDoubleClick.call(elementEvent);
        } else {
          ctx.hooks.elementPointerClick.call(elementEvent);
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
        unsubscribeClicks = scene.input.subscribeClicks(onClick);
        scene.input.focus();
        container.focus();
      });

      ctx.hooks.destroy.tap(() => {
        unsubscribeInput?.();
        unsubscribeInput = null;
        unsubscribeClicks?.();
        unsubscribeClicks = null;
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
