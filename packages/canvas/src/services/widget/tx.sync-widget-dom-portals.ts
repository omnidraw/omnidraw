import type Konva from "konva";
import { WIDGET_DOM_PORTAL_SYNC_ATTR } from "./CONSTANTS";

type TWidgetDomPortalSync = () => void;
type TFindableNode = Konva.Node & {
  find(callback: (node: Konva.Node) => boolean): Konva.Node[];
};

export type TPortalSyncWidgetDomPortals = Record<string, never>;

export type TArgsSyncWidgetDomPortals = {
  node: Konva.Node;
};

function callWidgetDomPortalSync(node: Konva.Node) {
  const syncWidgetDomPortal = node.getAttr(WIDGET_DOM_PORTAL_SYNC_ATTR) as TWidgetDomPortalSync | undefined;
  syncWidgetDomPortal?.();
}

export function txSyncWidgetDomPortals(
  portal: TPortalSyncWidgetDomPortals,
  args: TArgsSyncWidgetDomPortals,
) {
  callWidgetDomPortalSync(args.node);

  const findableNode = args.node as TFindableNode;
  if (typeof findableNode.find === "function") {
    findableNode.find((candidate: Konva.Node) => {
      callWidgetDomPortalSync(candidate);
      return false;
    });
  }

  void portal;
}
