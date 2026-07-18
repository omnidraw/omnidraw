import { defineTool } from '@earendil-works/pi-coding-agent';
import { execFile } from 'node:child_process';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { Type } from 'typebox';
import { txValidateWidgetFiles } from '../core/tx.validate-widget-files';
import type { WidgetWorkspace } from '../workspace/WidgetWorkspace';
import type { TWidgetMount } from '../workspace/types';
import { fnBuildWidgetCreateManifest } from './fn.widget-create';
import {
  fnCreateWidgetListCursor,
  fnParseWidgetListCursor,
  fnSortAvailableWidgets,
  fnWidgetListFingerprint,
} from './fn.widget-list';
import { fnToolError, fnToolSuccess } from './fn.result';
import { txWriteWidgetScaffold } from './tx.scaffold';
import type { TToolDefinition, TWidgetDraftChange } from './types';

type TCreateWidgetWorkspaceToolsArgs = {
  workspace: WidgetWorkspace;
  chatId: string;
  authorize: (toolName: 'vc_widget_list' | 'vc_widget_create' | 'vc_widget_validate') => Promise<boolean>;
  onMounted?: (mount: TWidgetMount) => void;
  onDraftChanged?: (change: TWidgetDraftChange) => void | Promise<void>;
};

export function createWidgetWorkspaceTools(args: TCreateWidgetWorkspaceToolsArgs): TToolDefinition[] {
  const list = defineTool({
    name: 'vc_widget_list',
    label: 'List Widgets',
    description: 'List bounded safe metadata for every shared draft and published widget without reading source files. Each result reports hasDraft and hasPublished. File tools can access shared drafts; published-only entries require a user-controlled frontend workflow.',
    parameters: Type.Object({
      cursor: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
    }, { additionalProperties: false }),
    async execute(_toolCallId, params: any) {
      if (!await args.authorize('vc_widget_list')) return fnToolError({ code: 'TOOL_NOT_AUTHORIZED', message: 'This tool call is not authorized.' });
      try {
        const widgets = fnSortAvailableWidgets(await args.workspace.listAvailableWidgets(args.chatId));
        const fingerprint = fnWidgetListFingerprint(widgets);
        const parsedCursor = params.cursor
          ? fnParseWidgetListCursor(params.cursor, fingerprint)
          : { ok: true as const, offset: 0 };
        if (!parsedCursor.ok || parsedCursor.offset > widgets.length) {
          return fnToolError({
            code: 'WIDGET_CURSOR_INVALID',
            message: 'Widget cursor is stale or invalid. Start a new list request without a cursor.',
          });
        }
        const limit = params.limit ?? 20;
        const page = widgets.slice(parsedCursor.offset, parsedCursor.offset + limit);
        const nextOffset = parsedCursor.offset + page.length;
        const modelData = {
          widgets: page,
          totalCount: widgets.length,
          nextCursor: nextOffset < widgets.length ? fnCreateWidgetListCursor(nextOffset, fingerprint) : null,
        };
        return fnToolSuccess({
          summary: `Found ${page.length} available widget${page.length === 1 ? '' : 's'} in this page.`,
          modelData,
          details: modelData,
        });
      } catch {
        return fnToolError({ code: 'WIDGET_LIST_FAILED', message: 'Available widgets could not be listed.' });
      }
    },
  }) as TToolDefinition;

  const create = defineTool({
    name: 'vc_widget_create',
    label: 'Create Widget Draft',
    description: 'Create a complete unpublished widget draft in the shared draft workspace. It becomes visible to every conversation under widgets/<name>. Use edit and patch afterward to implement product-specific behavior.',
    parameters: Type.Object({
      name: Type.String({ minLength: 1, maxLength: 120 }),
      kind: Type.Union([Type.Literal('widget'), Type.Literal('actor-widget')]),
      description: Type.Optional(Type.String({ maxLength: 2_000 })),
    }, { additionalProperties: false }),
    async execute(_toolCallId, params: any) {
      if (!await args.authorize('vc_widget_create')) return fnToolError({ code: 'TOOL_NOT_AUTHORIZED', message: 'This tool call is not authorized.' });
      try {
        const created = await args.workspace.createDraft(args.chatId, params, async ({ cwd, name, kind, description }) => {
          const manifest = fnBuildWidgetCreateManifest({ name, kind, description });
          return txWriteWidgetScaffold({ mkdir, writeFile, join }, {
            cwd,
            manifest,
            sdkDependency: `file:${args.workspace.sdkPackagePath}`,
          });
        });
        args.onMounted?.(created.mount);
        await args.onDraftChanged?.({ name: created.mount.name, type: 'created' });
        const modelData = {
          name: created.mount.name,
          mountPath: `widgets/${created.mount.name}`,
          source: created.mount.source,
          draft: true,
          files: created.files,
        };
        return fnToolSuccess({
          summary: `Created and mounted unpublished widget draft '${created.mount.name}'.`,
          modelData,
          details: modelData,
        });
      } catch (error) {
        return fnToolError({ code: 'WIDGET_CREATE_FAILED', message: error instanceof Error ? error.message : String(error) });
      }
    },
  }) as TToolDefinition;

  const validate = defineTool({
    name: 'vc_widget_validate',
    label: 'Validate Widget',
    description: 'Validate one widget from the shared draft workspace with the trusted host compiler and SDK declarations. This never publishes.',
    parameters: Type.Object({
      name: Type.String({ minLength: 1, maxLength: 120 }),
    }, { additionalProperties: false }),
    async execute(_toolCallId, params: any) {
      if (!await args.authorize('vc_widget_validate')) return fnToolError({ code: 'TOOL_NOT_AUTHORIZED', message: 'This tool call is not authorized.' });
      try {
        const mount = await args.workspace.findMountedWidget(args.chatId, params.name);
        const validation = await txValidateWidgetFiles({ readdir, readFile, writeFile, rm, execFile, join, relative }, {
          cwd: mount.targetPath,
          sdkActorTypePath: join(args.workspace.sdkPackagePath, 'src', 'actor.ts'),
        });
        const manifest = JSON.parse(await readFile(join(mount.targetPath, 'vibecanvas.json'), 'utf8')) as { name?: unknown };
        if (manifest.name !== mount.name) {
          validation.ok = false;
          validation.errors.push(`Published identity is '${mount.name}', but vibecanvas.json declares '${String(manifest.name)}'. Create and publish a new widget to rename it.`);
        }
        await args.onDraftChanged?.({
          name: mount.name,
          type: 'validated',
          validation: {
            ok: validation.ok,
            errors: validation.errors,
            warnings: validation.warnings,
          },
        });
        const errors = validation.errors.slice(0, 40);
        const warnings = validation.warnings.slice(0, 40);
        const files = validation.files.slice(0, 500);
        const modelData = {
          name: mount.name,
          mountPath: `widgets/${mount.name}`,
          source: mount.source,
          ok: validation.ok,
          errors,
          warnings,
          files,
          errorsTruncated: validation.errors.length > errors.length,
          warningsTruncated: validation.warnings.length > warnings.length,
          filesTruncated: validation.files.length > files.length,
        };
        return fnToolSuccess({
          summary: `Widget '${mount.name}' is ${validation.ok ? 'valid' : 'invalid'}.`,
          modelData,
          details: modelData,
        });
      } catch (error) {
        return fnToolError({ code: 'WIDGET_VALIDATE_FAILED', message: error instanceof Error ? error.message : String(error) });
      }
    },
  }) as TToolDefinition;

  return [list, create, validate];
}
