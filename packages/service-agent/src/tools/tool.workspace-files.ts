import { createReadToolDefinition, defineTool } from '@earendil-works/pi-coding-agent';
import { constants } from 'node:fs';
import { relative, sep } from 'node:path';
import { Type } from 'typebox';
import type { WidgetWorkspace } from '../workspace/WidgetWorkspace';
import { fnApplyExactEdits } from './fn.apply-exact-edits';
import { fnApplyUnifiedPatch } from './fn.apply-unified-patch';
import { fnToolError, fnToolSuccess } from './fn.result';
import type { TToolDefinition, TWidgetDraftChange } from './types';

type TCreateWorkspaceFileToolsArgs = {
  workspace: WidgetWorkspace;
  chatId: string;
  cwd: string;
  authorize: (toolName: 'read' | 'edit' | 'patch' | 'grep') => Promise<boolean>;
  onDraftChanged?: (change: TWidgetDraftChange) => void | Promise<void>;
};

function mountedWidgetName(path: string): string | undefined {
  const [root, name] = path.split('/');
  return root === 'widgets' && name ? name : undefined;
}

function lexicalPath(cwd: string, absolutePath: string): string {
  return relative(cwd, absolutePath).split(sep).join('/');
}

function wrapAuthorized(tool: TToolDefinition, authorize: () => Promise<boolean>): TToolDefinition {
  const execute = tool.execute.bind(tool);
  return {
    ...tool,
    async execute(...args: any[]) {
      if (!await authorize()) return fnToolError('This tool call is not authorized.');
      return (execute as (...executeArgs: any[]) => unknown)(...args);
    },
  } as TToolDefinition;
}

export function createWorkspaceFileTools(args: TCreateWorkspaceFileToolsArgs): TToolDefinition[] {
  const read = createReadToolDefinition(args.cwd, {
    autoResizeImages: false,
    operations: {
      access: async (absolutePath) => args.workspace.assertMountedFileAccess(args.chatId, lexicalPath(args.cwd, absolutePath), constants.R_OK),
      readFile: async (absolutePath) => args.workspace.readMountedFile(args.chatId, lexicalPath(args.cwd, absolutePath)),
    },
  }) as TToolDefinition;
  const edit = defineTool({
    name: 'edit',
    label: 'edit',
    description: 'Edit one mounted widget file with unique exact replacements. The complete read-modify-write operation is serialized on the shared widget folder.',
    parameters: Type.Object({
      path: Type.String({ minLength: 1, maxLength: 4_096 }),
      edits: Type.Array(Type.Object({
        oldText: Type.String({ minLength: 1, maxLength: 1_000_000 }),
        newText: Type.String({ maxLength: 1_000_000 }),
      }, { additionalProperties: false }), { minItems: 1, maxItems: 100 }),
    }, { additionalProperties: false }),
    async execute(_toolCallId, params: any) {
      if (!await args.authorize('edit')) return fnToolError('This tool call is not authorized.');
      try {
        if (JSON.stringify(params.edits).length > 2_000_000) throw new Error('Edit batch exceeds the total request-size limit.');
        await args.workspace.updateMountedFileAtomic(args.chatId, params.path, (source) => {
          const result = fnApplyExactEdits(source, params.edits);
          if (!result.ok) throw new Error(result.message);
          return { content: result.content, value: undefined };
        });
        const name = mountedWidgetName(params.path);
        if (name) await args.onDraftChanged?.({ name, type: 'changed' });
        return fnToolSuccess(`Successfully replaced ${params.edits.length} block(s) in ${params.path}.`, {
          path: params.path,
          replacements: params.edits.length,
        });
      } catch (error) {
        return fnToolError(error instanceof Error ? error.message : String(error));
      }
    },
  }) as TToolDefinition;

  const patch = defineTool({
    name: 'patch',
    label: 'patch',
    description: "Apply an exact unified diff to one mounted widget file. Paths must use 'widgets/<mounted-name>/...'.",
    parameters: Type.Object({
      path: Type.String({ minLength: 1, maxLength: 4_096 }),
      patch: Type.String({ minLength: 1, maxLength: 1_000_000 }),
    }, { additionalProperties: false }),
    async execute(_toolCallId, params: any) {
      if (!await args.authorize('patch')) return fnToolError('This tool call is not authorized.');
      try {
        await args.workspace.updateMountedFileAtomic(args.chatId, params.path, (source) => {
          const result = fnApplyUnifiedPatch(source, params.patch);
          if (!result.ok) throw new Error(result.message);
          return { content: result.content, value: undefined };
        }, { allowMissing: true });
        const name = mountedWidgetName(params.path);
        if (name) await args.onDraftChanged?.({ name, type: 'changed' });
        return fnToolSuccess(`Applied patch to ${params.path}.`, { path: params.path });
      } catch (error) {
        return fnToolError(error instanceof Error ? error.message : String(error));
      }
    },
  }) as TToolDefinition;

  const grep = defineTool({
    name: 'grep',
    label: 'grep',
    description: "Search mounted widget files only. The default path searches every widget explicitly loaded into this chat. Use literal for arbitrary text; regex mode accepts a bounded subset and requires start anchoring for '*' or '+'.",
    parameters: Type.Object({
      pattern: Type.String({ minLength: 1, maxLength: 1_000 }),
      path: Type.Optional(Type.String({ minLength: 1, maxLength: 4_096 })),
      glob: Type.Optional(Type.String({ minLength: 1, maxLength: 1_000 })),
      ignoreCase: Type.Optional(Type.Boolean()),
      literal: Type.Optional(Type.Boolean()),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })),
    }, { additionalProperties: false }),
    async execute(_toolCallId, params: any) {
      if (!await args.authorize('grep')) return fnToolError('This tool call is not authorized.');
      try {
        const result = await args.workspace.grepMountedFiles(args.chatId, params);
        const text = result.matches.length === 0
          ? 'No matches found.'
          : result.matches.map((match) => `${match.path}:${match.line}: ${match.text}`).join('\n');
        return fnToolSuccess(`${text}${result.truncated ? '\n\n[Results truncated by host bounds.]' : ''}`, result);
      } catch (error) {
        return fnToolError(error instanceof Error ? error.message : String(error));
      }
    },
  }) as TToolDefinition;

  return [
    wrapAuthorized(read, () => args.authorize('read')),
    edit,
    patch,
    grep,
  ];
}
