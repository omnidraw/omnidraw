import { defineTool } from '@earendil-works/pi-coding-agent';
import { execFile } from 'node:child_process';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { Type } from 'typebox';
import { Check } from 'typebox/value';
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
import type { TToolDefinition, TWidgetDraftChangeHandler } from './types';

type TCreateWidgetWorkspaceToolsArgs = {
  workspace: WidgetWorkspace;
  chatId: string;
  authorize: (toolName: 'vc_widget_list' | 'vc_widget_create' | 'vc_widget_validate') => Promise<boolean>;
  onMounted?: (mount: TWidgetMount) => void;
  onDraftChanged?: TWidgetDraftChangeHandler;
};

const WIDGET_CREATE_PARAMETERS = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 120 }),
  description: Type.Optional(Type.String({ maxLength: 2_000 })),
}, { additionalProperties: false });

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
    description: 'Create and mount one complete browser-first manifest-v3 Capsule widget draft. Continue by reading the generated files, editing the construction scaffold, then call vc_widget_validate. Add server files only when the requested widget needs a short server function.',
    parameters: WIDGET_CREATE_PARAMETERS,
    async execute(_toolCallId, params: any) {
      if (!await args.authorize('vc_widget_create')) return fnToolError({ code: 'TOOL_NOT_AUTHORIZED', message: 'This tool call is not authorized.' });
      if (!Check(WIDGET_CREATE_PARAMETERS, params)) {
        return fnToolError({
          code: 'WIDGET_CREATE_INPUT_INVALID',
          message: 'Widget creation accepts only a name and optional description.',
        });
      }
      let draftCreated = false;
      try {
        return await args.workspace.withDraftAuthoringOperation(params.name, async () => {
          const created = await args.workspace.createDraft(args.chatId, params, async ({ cwd, name, description }) => {
            const manifest = fnBuildWidgetCreateManifest({ name, description });
            const files = await txWriteWidgetScaffold({ mkdir, writeFile, join }, {
              cwd,
              manifest,
              sdkDependency: `file:${args.workspace.sdkPackagePath}`,
            });
            const validation = await txValidateWidgetFiles({ readdir, readFile, writeFile, rm, execFile, join, relative }, { cwd });
            if (!validation.ok) {
              throw new Error(`Generated widget scaffold is invalid: ${validation.errors.join('; ')}`);
            }
            return files;
          });
          draftCreated = true;
          args.onMounted?.(created.mount);
          const durable = await args.onDraftChanged?.({ name: created.mount.name, type: 'created' });
          const modelData = {
            name: created.mount.name,
            ...(durable ? { draftId: durable.draftId } : {}),
            mountPath: `widgets/${created.mount.name}`,
            source: created.mount.source,
            draft: true,
            files: created.files,
          };
          return fnToolSuccess({
            summary: `Created and mounted runnable unpublished widget draft '${created.mount.name}'. Read and edit its construction scaffold, then validate it.`,
            modelData,
            details: modelData,
          });
        });
      } catch (error) {
        return fnToolError({
          code: 'WIDGET_CREATE_FAILED',
          message: error instanceof Error ? error.message : String(error),
          ...(draftCreated ? { modelData: { name: params.name, draftCreated: true } } : {}),
        });
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
        return await args.workspace.withDraftAuthoringOperation(mount.name, async () => {
          const validation = await txValidateWidgetFiles({ readdir, readFile, writeFile, rm, execFile, join, relative }, {
            cwd: mount.targetPath,
          });
          const manifest = JSON.parse(await readFile(join(mount.targetPath, 'vibecanvas.json'), 'utf8')) as { name?: unknown };
          if (manifest.name !== mount.name) {
            validation.ok = false;
            validation.errors.push(`Published identity is '${mount.name}', but vibecanvas.json declares '${String(manifest.name)}'. Create and publish a new widget to rename it.`);
          }
          const durable = await args.onDraftChanged?.({
            name: mount.name,
            type: 'validated',
          });
          if (args.onDraftChanged && !durable) {
            throw new Error('Trusted widget validation did not return durable draft status.');
          }
          if (durable && durable.validation.status === 'unknown') {
            throw new Error('Trusted widget validation did not complete for the current draft revision.');
          }
          const authoritative = durable
            ? {
                ok: durable.validation.status === 'valid',
                errors: [...durable.validation.errors],
                warnings: [...durable.validation.warnings],
              }
            : validation;
          const errors = authoritative.errors.slice(0, 40);
          const warnings = authoritative.warnings.slice(0, 40);
          const files = validation.files.slice(0, 500);
          const modelData = {
            name: mount.name,
            ...(durable ? { draftId: durable.draftId, revision: durable.revision } : {}),
            mountPath: `widgets/${mount.name}`,
            source: mount.source,
            ok: authoritative.ok,
            errors,
            warnings,
            files,
            errorsTruncated: authoritative.errors.length > errors.length,
            warningsTruncated: authoritative.warnings.length > warnings.length,
            filesTruncated: validation.files.length > files.length,
          };
          return fnToolSuccess({
            summary: `Widget '${mount.name}' is ${authoritative.ok ? 'valid' : 'invalid'}.`,
            modelData,
            details: modelData,
          });
        });
      } catch (error) {
        return fnToolError({ code: 'WIDGET_VALIDATE_FAILED', message: error instanceof Error ? error.message : String(error) });
      }
    },
  }) as TToolDefinition;

  return [list, create, validate];
}
