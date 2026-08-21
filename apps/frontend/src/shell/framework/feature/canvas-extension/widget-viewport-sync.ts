import type { TWidgetFrameNode } from "@omnidraw/canvas-contract";
import type { TWidgetViewport } from "@omnidraw/sdk";

import {
  fnWidgetViewport,
  type TWidgetViewportScheduling,
} from "@/core/widgets/fn.widget-viewport";

type TViewportSink = Readonly<{
  setViewport(viewport: TWidgetViewport): void;
}>;

type TWidgetViewportSyncArgs = Readonly<{
  container: HTMLElement;
  createResizeObserver(callback: ResizeObserverCallback): ResizeObserver;
  devicePixelRatio(): number;
  node: TWidgetFrameNode;
  scheduling: TWidgetViewportScheduling;
}>;

/** Keeps Capsule's viewport aligned with the live Canvas portal content box. */
export function createWidgetViewportSync(args: TWidgetViewportSyncArgs): Readonly<{
  attach(sink: TViewportSink, appliedViewport: TWidgetViewport): void;
  current(): TWidgetViewport;
  detach(sink: TViewportSink): void;
  disconnect(): void;
  updateNode(node: TWidgetFrameNode): void;
  updateScheduling(scheduling: TWidgetViewportScheduling): void;
}> {
  let node = args.node;
  let scheduling = args.scheduling;
  let hostWidth = args.container.clientWidth;
  let hostHeight = args.container.clientHeight;
  let sink: TViewportSink | null = null;
  let lastViewport: TWidgetViewport | null = null;
  let disposed = false;

  const current = (): TWidgetViewport => fnWidgetViewport({
    node,
    width: hostWidth,
    height: hostHeight,
    devicePixelRatio: args.devicePixelRatio(),
    scheduling,
  });
  const sync = (): void => {
    if (disposed || sink === null) return;
    const next = current();
    if (
      lastViewport !== null
      && next.width === lastViewport.width
      && next.height === lastViewport.height
      && next.scale === lastViewport.scale
      && next.visibility === lastViewport.visibility
      && next.distance === lastViewport.distance
      && next.priority === lastViewport.priority
      && next.occlusion === lastViewport.occlusion
    ) return;
    sink.setViewport(next);
    lastViewport = next;
  };
  const observer = args.createResizeObserver((entries) => {
    const entry = entries.find((candidate) => candidate.target === args.container);
    if (entry === undefined) return;
    hostWidth = entry.contentRect.width;
    hostHeight = entry.contentRect.height;
    sync();
  });
  observer.observe(args.container);

  return Object.freeze({
    attach(nextSink, appliedViewport) {
      sink = nextSink;
      lastViewport = appliedViewport;
      sync();
    },
    current,
    detach(retiredSink) {
      if (sink !== retiredSink) return;
      sink = null;
      lastViewport = null;
    },
    disconnect() {
      disposed = true;
      sink = null;
      observer.disconnect();
    },
    updateNode(nextNode) {
      node = nextNode;
      sync();
    },
    updateScheduling(nextScheduling) {
      scheduling = nextScheduling;
      sync();
    },
  });
}
