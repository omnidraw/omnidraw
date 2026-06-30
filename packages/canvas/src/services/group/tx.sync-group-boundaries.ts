import type { ThemeService } from "@vibecanvas/service-theme";
import type Konva from "konva";
import { isCanvasGroupNode } from "../../core/GUARDS";
import type { SceneService, SelectionService } from "../../services";
import { fxCreateGroupBoundary } from "./fx.create-group-boundary";

export type TGroupBoundary = ReturnType<typeof fxCreateGroupBoundary>;

export type TPortalSyncGroupBoundaries = {
  scene: SceneService;
  selection: SelectionService;
  theme: ThemeService;
  boundaries: Map<string, TGroupBoundary>;
  createGroupBoundary: (group: Konva.Group) => TGroupBoundary;
};

export type TArgsSyncGroupBoundaries = Record<string, never>;

export function txSyncGroupBoundaries(
  portal: TPortalSyncGroupBoundaries,
  args: TArgsSyncGroupBoundaries,
) {
  const markedToRemove = new Set(portal.boundaries.keys());

  portal.selection.selection
    .filter((node): node is Konva.Group => isCanvasGroupNode(node))
    .forEach((group) => {
      const boundary = portal.boundaries.get(group.id()) ?? portal.createGroupBoundary(group);
      boundary.syncTheme();
      portal.boundaries.set(group.id(), boundary);
      portal.scene.dynamicLayer.add(boundary.node);
      boundary.show();
      markedToRemove.delete(group.id());
    });

  markedToRemove.forEach((id) => {
    const boundary = portal.boundaries.get(id);
    if (!boundary) {
      return;
    }

    boundary.hide();
    boundary.node.destroy();
    portal.boundaries.delete(id);
  });

  void args;
}
