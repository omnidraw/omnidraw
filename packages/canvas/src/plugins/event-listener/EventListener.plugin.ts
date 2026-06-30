import type { IPlugin } from "@vibecanvas/runtime";
import Konva from "konva";
import type { SceneService } from "../../services/scene/SceneService";
import type { IRuntimeHooks, TElementPointerEvent, TMouseEvent, TPointerEvent, TWheelEvent } from "../../types";

function isInsideHostedWidget(target: EventTarget | null) {
  return target instanceof HTMLElement && target.closest('[data-hosted-widget-root="true"]') !== null;
}

function isTransformerNode(target: unknown) {
  if (!(target instanceof Konva.Node)) {
    return false;
  }

  let current: Konva.Node | null = target;
  while (current) {
    if (current instanceof Konva.Transformer) {
      return true;
    }

    current = current.getParent();
  }

  return false;
}

function isInteractionOverlayNode(target: unknown) {
  if (!(target instanceof Konva.Node)) {
    return false;
  }

  let current: Konva.Node | null = target;
  while (current) {
    if (current.getAttr("vcInteractionOverlay") === true) {
      return true;
    }

    current = current.getParent();
  }

  return false;
}

function getElementPointerEvent(event: TPointerEvent) {
  const target = event.target;
  if (!(target instanceof Konva.Group || target instanceof Konva.Shape)) {
    return null;
  }

  if (isTransformerNode(target) || isInteractionOverlayNode(target)) {
    return null;
  }

  return event as TElementPointerEvent;
}

/**
 * Bridges stage and DOM input into runtime hooks.
 * Keeps raw input wiring out of feature plugins.
 */
export function createEventListenerPlugin(): IPlugin<{
  scene: SceneService;
}, IRuntimeHooks> {
  return {
    name: "event-listener",
    apply(ctx) {
      ctx.hooks.init.tap(() => {
        const scene = ctx.services.require("scene");
        const stage = scene.stage;
        const container = stage.container();

        const onPointerDown = (event: TPointerEvent) => {
          ctx.hooks.pointerDown.call(event);
        };

        const onPointerUp = (event: TPointerEvent) => {
          ctx.hooks.pointerUp.call(event);
        };

        const onPointerMove = (event: TMouseEvent) => {
          ctx.hooks.pointerMove.call(event);
        };

        const onPointerOut = (event: TPointerEvent) => {
          ctx.hooks.pointerOut.call(event);
        };

        const onPointerOver = (event: TPointerEvent) => {
          ctx.hooks.pointerOver.call(event);
        };

        const onPointerCancel = (event: TPointerEvent) => {
          ctx.hooks.pointerCancel.call(event);
        };

        const onPointerWheel = (event: TWheelEvent) => {
          ctx.hooks.pointerWheel.call(event);
        };

        const onElementPointerClick = (event: TPointerEvent) => {
          const elementEvent = getElementPointerEvent(event);
          if (!elementEvent) {
            return;
          }

          ctx.hooks.elementPointerClick.call(elementEvent);
        };

        const onElementPointerDown = (event: TPointerEvent) => {
          const elementEvent = getElementPointerEvent(event);
          if (!elementEvent) {
            return;
          }

          const didHandle = ctx.hooks.elementPointerDown.call(elementEvent);
          if (didHandle) {
            event.cancelBubble = true;
          }
        };

        const onElementPointerDoubleClick = (event: TPointerEvent) => {
          const elementEvent = getElementPointerEvent(event);
          if (!elementEvent) {
            return;
          }

          const didHandle = ctx.hooks.elementPointerDoubleClick.call(elementEvent);
          if (didHandle) {
            event.cancelBubble = true;
          }
        };

        const onKeyDown = (event: KeyboardEvent) => {
          if (isInsideHostedWidget(event.target)) return;
          ctx.hooks.keydown.call(event);
        };

        const onKeyUp = (event: KeyboardEvent) => {
          if (isInsideHostedWidget(event.target)) return;
          ctx.hooks.keyup.call(event);
        };

        stage.on("pointerdown", onPointerDown);
        stage.on("pointerup", onPointerUp);
        stage.on("pointermove", onPointerMove);
        stage.on("pointerout", onPointerOut);
        stage.on("pointerover", onPointerOver);
        stage.on("pointercancel", onPointerCancel);
        stage.on("wheel", onPointerWheel);
        stage.on("pointerclick", onElementPointerClick);
        stage.on("pointerdown", onElementPointerDown);
        stage.on("pointerdblclick", onElementPointerDoubleClick);

        container.addEventListener("keydown", onKeyDown);
        container.addEventListener("keyup", onKeyUp);
        container.tabIndex = 1;
        container.focus();
        container.style.outline = "none";

        ctx.hooks.destroy.tap(() => {
          stage.off("pointerdown", onPointerDown);
          stage.off("pointerup", onPointerUp);
          stage.off("pointermove", onPointerMove);
          stage.off("pointerout", onPointerOut);
          stage.off("pointerover", onPointerOver);
          stage.off("pointercancel", onPointerCancel);
          stage.off("wheel", onPointerWheel);
          stage.off("pointerclick", onElementPointerClick);
          stage.off("pointerdown", onElementPointerDown);
          stage.off("pointerdblclick", onElementPointerDoubleClick);
          container.removeEventListener("keydown", onKeyDown);
          container.removeEventListener("keyup", onKeyUp);
        });
      });
    },
  };
}
