import { getVibecanvasBridge } from "./bridge";
import type { TVibecanvasActorSnapshot } from "./bridge";

type TVibecanvasWidgetMountArgs = {
  root: HTMLElement;
};

type TVibecanvasWidgetCleanup = () => void;

type TVibecanvasWidget = (args: TVibecanvasWidgetMountArgs) => void | TVibecanvasWidgetCleanup;

function defineWidget(widget: TVibecanvasWidget) {
  return widget;
}

function useActor() {
  const bridge = getVibecanvasBridge();

  return {
    async snapshot() {
      return bridge.getActorSnapshot();
    },
    state() {
      const snapshot = bridge.getActorSnapshot();
      return snapshot instanceof Promise ? null : snapshot;
    },
    send(eventName: string, params: Record<string, unknown> = {}, correlationId?: string) {
      return bridge.sendActorMessage(eventName, params, correlationId);
    },
    onState(callback: (snapshot: TVibecanvasActorSnapshot) => void) {
      return bridge.onActorSnapshot(callback);
    },
    requestHostUpdate(patch: { width?: number; height?: number; window?: "contained" | "minimized" | "fullscreen" }) {
      return bridge.requestHostUpdate?.(patch);
    },
  };
}

export { defineWidget, useActor };
export type { TVibecanvasWidget, TVibecanvasWidgetCleanup, TVibecanvasWidgetMountArgs };
