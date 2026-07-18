import type Konva from "konva";
import { VC_ELEMENT_DOM_PORTAL_SYNC_ATTR } from "../../core/CONSTANTS";

type TPortal = Record<string, never>;
type TArgs = { node: Konva.Node };
type TDomPortalSync = () => void;
type TFindableNode = Konva.Node & {
  find(callback: (node: Konva.Node) => boolean): Konva.Node[];
};

function txSyncElementDomPortal(portal: TPortal, args: TArgs) {
  const sync = args.node.getAttr(VC_ELEMENT_DOM_PORTAL_SYNC_ATTR) as TDomPortalSync | undefined;
  sync?.();
  void portal;
}

export function txSyncElementDomPortals(portal: TPortal, args: TArgs) {
  txSyncElementDomPortal(portal, args);
  const findableNode = args.node as TFindableNode;
  if (typeof findableNode.find !== "function") return;
  findableNode.find((candidate) => {
    txSyncElementDomPortal(portal, { node: candidate });
    return false;
  });
}
