import type { ToolService } from "../../services";
import type { TShape1dTool } from "./CONSTANTS";

export type TPortalTxRegisterShape1dTool = {
  tool: ToolService;
};

export type TArgsTxRegisterShape1dTool = {
  id: TShape1dTool;
  label: string;
  icon: string;
  shortcuts: string[];
  priority: number;
};

export function txRegisterShape1dTool(portal: TPortalTxRegisterShape1dTool, args: TArgsTxRegisterShape1dTool) {
  portal.tool.registerTool({
    id: args.id,
    label: args.label,
    icon: args.icon,
    shortcuts: args.shortcuts,
    priority: args.priority,
    behavior: { type: "mode", mode: "draw-create" },
  });

  return () => {
    portal.tool.unregisterTool(args.id);
  };
}
