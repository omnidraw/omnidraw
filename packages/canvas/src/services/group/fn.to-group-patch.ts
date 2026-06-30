import type { TGroup } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import type Konva from "konva";
import type { GroupService } from "./GroupService";

export type TArgsToGroupPatch = {
  groupService: GroupService;
  group: Konva.Group;
  getNodeZIndex: (node: Konva.Group) => string;
  fallbackCreatedAt: number;
};

export function fnToGroupPatch(args: TArgsToGroupPatch): TGroup {
  const parent = args.group.getParent();
  return {
    id: args.group.id(),
    parentGroupId: parent && args.groupService.toGroup(parent) ? parent.id() : null,
    zIndex: args.getNodeZIndex(args.group),
    locked: false,
    createdAt: Number(args.group.getAttr("vcGroupCreatedAt") ?? args.fallbackCreatedAt),
  };
}
