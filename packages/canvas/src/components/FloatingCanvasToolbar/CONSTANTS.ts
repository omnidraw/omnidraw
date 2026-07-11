import LayoutGrid from "lucide-static/icons/layout-grid.svg?raw";
import type { TToolGroupDefinition } from "./fn.runtime-toolbar";

export const DEFAULT_TOOL_GROUP_DEFINITION: TToolGroupDefinition = {
  icon: LayoutGrid,
};

export const TOOL_GROUPS_CHANGED_EVENT = "vibecanvas:tool-groups-changed";

export const TOOLBAR_MAX_COLUMNS = 3;
export const TOOLBAR_VIEWPORT_GUTTER_PX = 12;
export const TOOLBAR_HEADER_HEIGHT_PX = 23;
export const TOOLBAR_TOOL_HEIGHT_PX = 28;
export const TOOLBAR_WIDE_TOOL_HEIGHT_PX = 36;
