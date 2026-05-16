import type Konva from "konva";
import type { SelectionService } from "../selection/SelectionService";

type TPortalSyncWidgetConnections = {
  Circle?: typeof Konva.Circle;
  Group: typeof Konva.Group;
  Line?: typeof Konva.Line;
  selection?: SelectionService;
};

type TArgsSyncWidgetConnections = {
  node: Konva.Node;
  scope?: "all" | "attached";
  syncHandles?: boolean;
};

export function txSyncWidgetConnections(portal: TPortalSyncWidgetConnections, args: TArgsSyncWidgetConnections) {
  void portal;
  void args;
  return false;
}
