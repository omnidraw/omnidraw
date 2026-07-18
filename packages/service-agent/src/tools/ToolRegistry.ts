import type { ApprovalCoordinator } from '../approval/ApprovalCoordinator';
import type { TToolAuthorizationContext, TToolAuthorizer } from '../approval/types';
import type { WidgetWorkspace } from '../workspace/WidgetWorkspace';
import type { TWidgetMount } from '../workspace/types';
import { AI_CHAT_TOOL_NAMES } from './CONSTANTS';
import { fnToolError } from './fn.result';
import { createBashTool } from './tool.bash';
import { createResourceTools } from './tool.resources';
import { createWebFetchTool } from './tool.web-fetch';
import { createWidgetWorkspaceTools } from './tool.widget-workspace';
import { createWorkspaceFileTools } from './tool.workspace-files';
import type { TActorServiceReloader, TToolDefinition, TWidgetDraftChange } from './types';

type TCreateToolRegistryArgs = {
  chatId: string;
  cwd: string;
  authorization: TToolAuthorizationContext;
  authorize?: TToolAuthorizer;
  workspace: WidgetWorkspace;
  approvals: ApprovalCoordinator;
  actorService?: TActorServiceReloader;
  onMounted?: (mount: TWidgetMount) => void;
  onDraftChanged?: (change: TWidgetDraftChange) => void | Promise<void>;
  takeSensitiveToolArgs?: (toolCallId: string) => unknown;
};

function wrapAuthorized(tool: TToolDefinition, authorize: () => Promise<boolean>): TToolDefinition {
  const execute = tool.execute.bind(tool);
  return {
    ...tool,
    async execute(...args: any[]) {
      if (!await authorize()) return fnToolError({ code: 'TOOL_NOT_AUTHORIZED', message: 'This tool call is not authorized.' });
      return (execute as (...executeArgs: any[]) => unknown)(...args);
    },
  } as TToolDefinition;
}

export function createToolRegistry(args: TCreateToolRegistryArgs): { toolNames: string[]; customTools: TToolDefinition[] } {
  const authorize = async (toolName: string) => args.authorize
    ? args.authorize({ chatId: args.chatId, toolName, context: args.authorization })
    : true;
  const tools = [
    ...createWidgetWorkspaceTools({
      workspace: args.workspace,
      chatId: args.chatId,
      authorize: (toolName) => authorize(toolName),
      onMounted: args.onMounted,
      onDraftChanged: args.onDraftChanged,
    }),
    ...createWorkspaceFileTools({
      workspace: args.workspace,
      chatId: args.chatId,
      cwd: args.cwd,
      authorize: (toolName) => authorize(toolName),
      onDraftChanged: args.onDraftChanged,
    }),
    ...createResourceTools({
      chatId: args.chatId,
      authorization: args.authorization,
      actorService: args.actorService,
      approvals: args.approvals,
      authorize,
      takeSensitiveToolArgs: args.takeSensitiveToolArgs,
    }),
    wrapAuthorized(createWebFetchTool(), () => authorize('web_fetch')),
    createBashTool({ cwd: args.cwd, authorize: () => authorize('bash') }),
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
