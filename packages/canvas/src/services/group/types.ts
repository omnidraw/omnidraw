import type { TGroup } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import type { SyncHook } from "@vibecanvas/tapable";
import type Konva from "konva";

export type TGroupDefinition = {
  /**
   * Unique registration id for this group definition.
   * Groups are single-owner registrations and are not layered like elements.
   */
  id: string;
  /**
   * Lower priority runs first.
   * Usually groups should not overlap, but this keeps lookup deterministic.
   */
  priority?: number;
  /**
   * Matches runtime nodes that belong to this persisted group type.
   */
  matchesNode: (node: Konva.Node) => boolean;
  /**
   * Serializes one runtime node into one persisted group.
   */
  toGroup: (node: Konva.Node) => TGroup | null;
  /**
   * Creates one root runtime node for the group.
   */
  createNode: (group: TGroup) => Konva.Group | null;
  /**
   * Attaches runtime listeners for the group root node.
   */
  attachListeners?: (node: Konva.Group) => boolean;
};

export interface TGroupServiceHooks {
  groupsChange: SyncHook<[]>;
}
