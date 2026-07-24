import type { SyncHook } from "@vibecanvas/tapable";
import type { ContextMenuService } from "../context-menu/ContextMenuService";
import type { CrdtService } from "../crdt/CrdtService";
import type { HistoryService } from "../history/HistoryService";
import type { SelectionService } from "../selection/SelectionService";

export type TGroupServiceArgs = {
  contextMenu: ContextMenuService;
  crdt: CrdtService;
  history: HistoryService;
  selection: SelectionService;
  createId(): string;
  now(): number;
};

export type TGroupMoveArgs = {
  groupIds: readonly string[];
  delta: {
    x: number;
    y: number;
  };
};

export interface TGroupServiceHooks {
  groupsChange: SyncHook<[]>;
}
