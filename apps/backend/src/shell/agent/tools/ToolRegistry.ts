import type { ApprovalCoordinator } from '../approval/ApprovalCoordinator';
import type { TToolAuthorizer } from '../approval/types';
import type { WidgetWorkspace } from '../workspace/WidgetWorkspace';
import type { TWidgetMount } from '../workspace/types';
import { AI_CHAT_TOOL_NAMES } from './CONSTANTS';
import { createResourceTools } from './tool.resources';
import type { TAgentResourceService } from './resource-service';
import { createWidgetPreviewInspectTool } from './tool.widget-preview-inspect';
import { createWidgetWorkspaceTools } from './tool.widget-workspace';
import { createWorkspaceFileTools } from './tool.workspace-files';
import type {
  TToolDefinition,
  TWidgetDraftChangeHandler,
  TWidgetPreviewBuildCheck,
  TWidgetPreviewInspectionCapability,
} from './types';

type TCreateToolRegistryArgs = {
  chatId: string;
  cwd: string;
  authorize?: TToolAuthorizer;
  workspace: WidgetWorkspace;
  approvals: ApprovalCoordinator;
  resourceService?: TAgentResourceService;
  listAvailableWidgets?: Parameters<typeof createWidgetWorkspaceTools>[0]['listAvailableWidgets'];
  loadWidget?: Parameters<typeof createWidgetWorkspaceTools>[0]['loadWidget'];
  onMounted?: (mount: TWidgetMount) => void;
  onDraftChanged?: TWidgetDraftChangeHandler;
  previewBuild?: TWidgetPreviewBuildCheck;
  previewInspection?: TWidgetPreviewInspectionCapability;
  resolvePreviewScope?: (name: string) => Promise<Readonly<{
    canvasId: string;
    aiChatElementId: string;
  }> | null>;
  takeSensitiveToolArgs?: (toolCallId: string) => unknown;
};

export function createToolRegistry(args: TCreateToolRegistryArgs): { toolNames: string[]; customTools: TToolDefinition[] } {
  const authorize = async (toolName: string) => args.authorize
    ? args.authorize({ chatId: args.chatId, toolName })
    : true;
  const tools = [
    ...createWidgetWorkspaceTools({
      workspace: args.workspace,
      chatId: args.chatId,
      authorize: (toolName) => authorize(toolName),
      listAvailableWidgets: args.listAvailableWidgets,
      loadWidget: args.loadWidget,
      onMounted: args.onMounted,
      previewBuild: args.previewBuild,
      onDraftChanged: args.onDraftChanged
        ? (change) => args.onDraftChanged?.({ ...change, chatId: args.chatId })
        : undefined,
    }),
    createWidgetPreviewInspectTool({
      workspace: args.workspace,
      chatId: args.chatId,
      authorize: () => authorize('od_widget_preview_inspect'),
      capability: args.previewInspection,
      resolvePreviewScope: args.resolvePreviewScope,
    }),
    ...createWorkspaceFileTools({
      workspace: args.workspace,
      chatId: args.chatId,
      cwd: args.cwd,
      authorize: (toolName) => authorize(toolName),
      onDraftChanged: args.onDraftChanged
        ? (change) => args.onDraftChanged?.({ ...change, chatId: args.chatId })
        : undefined,
    }),
    ...createResourceTools({
      chatId: args.chatId,
      resourceService: args.resourceService,
      approvals: args.approvals,
      authorize,
      takeSensitiveToolArgs: args.takeSensitiveToolArgs,
    }),
  ];
  const definitions = new Map(tools.map((tool) => [tool.name, tool]));
  const missing = AI_CHAT_TOOL_NAMES.filter((name) => !definitions.has(name));
  const extra = tools.filter((tool) => !AI_CHAT_TOOL_NAMES.includes(tool.name as typeof AI_CHAT_TOOL_NAMES[number]));
  const duplicates = tools
    .filter((tool, index) => tools.findIndex((candidate) => candidate.name === tool.name) !== index)
    .map((tool) => tool.name);
  if (
    missing.length > 0
    || extra.length > 0
    || duplicates.length > 0
    || tools.length !== AI_CHAT_TOOL_NAMES.length
    || definitions.size !== AI_CHAT_TOOL_NAMES.length
  ) {
    throw new Error(`Invalid AI Chat tool registry. Missing: ${missing.join(', ') || 'none'}; extra: ${extra.map((tool) => tool.name).join(', ') || 'none'}; duplicates: ${duplicates.join(', ') || 'none'}.`);
  }
  return {
    toolNames: [...AI_CHAT_TOOL_NAMES],
    customTools: AI_CHAT_TOOL_NAMES.map((name) => definitions.get(name)!),
  };
}
