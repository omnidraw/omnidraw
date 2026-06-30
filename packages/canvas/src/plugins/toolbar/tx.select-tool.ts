import type { ToolService } from "../../services";

type TPortal = {
  toolService: ToolService;
}

type TArgs = {
  toolId: string;
}

export function txSelectTool(portal: TPortal, args: TArgs) {
  const tool = portal.toolService.getTool(args.toolId);
  if (!tool) {
    return false;
  }

  if (tool.behavior.type === "mode") {
    portal.toolService.setActiveTool(args.toolId);
    return true;
  }

  tool.onSelect?.();
  return true;
}
