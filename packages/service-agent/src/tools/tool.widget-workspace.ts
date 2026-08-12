import { defineTool } from '@earendil-works/pi-coding-agent';
import { execFile } from 'node:child_process';
import { access, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, join, relative } from 'node:path';
import { Type } from 'typebox';
import { Check } from 'typebox/value';
import { txValidateWidgetFiles } from '../core/tx.validate-widget-files';
import {
  SDK_CAPSULE_DEPENDENCY,
  SDK_PACKAGE_DEPENDENCY,
} from '../workspace/CONSTANTS';
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
import { txTryNpmInstall, type TNpmInstall } from './tx.npm-install';
import type { TToolDefinition, TWidgetDraftChangeHandler, TWidgetPreviewBuildCheck } from './types';

type TCreateWidgetWorkspaceToolsArgs = {
  workspace: WidgetWorkspace;
  chatId: string;
  authorize: (toolName: 'od_widget_list' | 'od_widget_create' | 'od_widget_validate') => Promise<boolean>;
  onMounted?: (mount: TWidgetMount) => void;
  onDraftChanged?: TWidgetDraftChangeHandler;
  previewBuild?: TWidgetPreviewBuildCheck;
  npmInstall?: TNpmInstall;
};

const WIDGET_CREATE_PARAMETERS = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 120 }),
  description: Type.Optional(Type.String({ maxLength: 2_000 })),
  template: Type.Optional(Type.Union([
    Type.Literal('plain'),
    Type.Literal('react'),
  ])),
  server: Type.Optional(Type.Boolean()),
}, { additionalProperties: false });

export function createWidgetWorkspaceTools(args: TCreateWidgetWorkspaceToolsArgs): TToolDefinition[] {
  const list = defineTool({
    name: 'od_widget_list',
    label: 'List Widgets',
    description: 'List bounded safe metadata for every shared draft and published widget without reading source files. Each result reports hasDraft and hasPublished. File tools can access shared drafts; published-only entries require a user-controlled frontend workflow.',
    parameters: Type.Object({
      cursor: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
    }, { additionalProperties: false }),
    async execute(_toolCallId, params: any) {
      if (!await args.authorize('od_widget_list')) return fnToolError({ code: 'TOOL_NOT_AUTHORIZED', message: 'This tool call is not authorized.' });
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
    name: 'od_widget_create',
    label: 'Create Widget Draft',
    description: 'Create and mount one complete browser-first manifest v1 Capsule widget draft in the shared widgets/drafts root. Choose template "react" for a ready React/TypeScript starter with dependencies already installed; omit it for plain DOM. Set server true when the request needs a valid short server-function starter and manifest section. Keep the scaffolded manifest v1 fields ($schema, schemaVersion 1, tool) intact. Read only files you need to change, edit them, then call od_widget_validate.',
    parameters: WIDGET_CREATE_PARAMETERS,
    async execute(_toolCallId, params: any) {
      if (!await args.authorize('od_widget_create')) return fnToolError({ code: 'TOOL_NOT_AUTHORIZED', message: 'This tool call is not authorized.' });
      if (!Check(WIDGET_CREATE_PARAMETERS, params)) {
        return fnToolError({
          code: 'WIDGET_CREATE_INPUT_INVALID',
          message: 'Widget creation accepts only a name, optional description, optional plain or react template, and optional server flag.',
        });
      }
      let draftCreated = false;
      try {
        return await args.workspace.withDraftAuthoringOperation(params.name, async () => {
          const created = await args.workspace.createDraft(args.chatId, params, async ({ cwd, name, description, template, server }) => {
            const selectedTemplate = template ?? 'plain';
            const manifest = fnBuildWidgetCreateManifest({
              name,
              description,
              template: selectedTemplate,
              server,
            });
            const files = await txWriteWidgetScaffold({ mkdir, writeFile, join }, {
              cwd,
              manifest,
              sdkDependency: SDK_PACKAGE_DEPENDENCY,
              capsuleDependency: SDK_CAPSULE_DEPENDENCY,
              template: selectedTemplate,
              server: server === true,
            });
            await args.workspace.prepareNpmDependencies();
            const installed = await (args.npmInstall
              ? args.npmInstall(cwd)
              : txTryNpmInstall({ access, execFile, join }, {
                  cwd,
                  userConfigPath: args.workspace.npmUserConfigPath,
                }));
            if (installed.status !== 'success') {
              throw new Error(
                installed.status === 'error'
                  ? `Generated widget dependency installation failed: ${installed.message}`
                  : `Generated widget dependency installation was skipped: ${installed.reason}`,
              );
            }
            files.push('package-lock.json');
            const validation = await txValidateWidgetFiles({ readdir, readFile, writeFile, rm, execFile, join, relative }, { cwd });
            if (!validation.ok) {
              throw new Error(`Generated widget scaffold is invalid: ${validation.errors.join('; ')}`);
            }
            return files;
          });
          draftCreated = true;
          args.onMounted?.(created.mount);
          await args.onDraftChanged?.({ name: created.mount.name, type: 'created' });
          if (args.previewBuild !== undefined) {
            const build = await args.previewBuild({ slug: basename(created.mount.targetPath) });
            if (!build.ok) {
              throw new Error(`Initial portable widget build failed: ${build.errors.join('; ')}`);
            }
          }
          const template = params.template ?? 'plain';
          const server = params.server === true;
          const editableEntry = template === 'react' ? 'ui/main.tsx' : 'ui/main.ts';
          const modelData = {
            name: created.mount.name,
            mountPath: `widgets/${created.mount.name}`,
            source: created.mount.source,
            draft: true,
            template,
            server,
            files: created.files,
            recommendedReads: [
              `widgets/${created.mount.name}/${editableEntry}`,
              `widgets/${created.mount.name}/ui/styles.css`,
              ...(server
                ? [`widgets/${created.mount.name}/server/main.server.ts`]
                : []),
            ],
          };
          return fnToolSuccess({
            summary: `Created and mounted runnable unpublished ${template === 'react' ? 'React' : 'plain DOM'}${server ? ' with server function' : ''} widget draft '${created.mount.name}'. Read the recommended editable files, make the requested change, then validate it.`,
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
    name: 'od_widget_validate',
    label: 'Validate Widget',
    description: 'Validate one widget from the shared draft workspace with the trusted host compiler and SDK declarations, then run the accepted-artifact build when the host provides it. This does not mount a live Preview, exercise resources, or publish.',
    parameters: Type.Object({
      name: Type.String({ minLength: 1, maxLength: 120 }),
    }, { additionalProperties: false }),
    async execute(_toolCallId, params: any) {
      if (!await args.authorize('od_widget_validate')) return fnToolError({ code: 'TOOL_NOT_AUTHORIZED', message: 'This tool call is not authorized.' });
      try {
        const mount = await args.workspace.findMountedWidget(args.chatId, params.name);
        return await args.workspace.withDraftAuthoringOperation(mount.name, async () => {
          const validation = await txValidateWidgetFiles({ readdir, readFile, writeFile, rm, execFile, join, relative }, {
            cwd: mount.targetPath,
          });
          const manifest = JSON.parse(await readFile(join(mount.targetPath, 'omnidraw.json'), 'utf8')) as { name?: unknown };
          if (manifest.name !== mount.name) {
            validation.ok = false;
            validation.errors.push(`Published identity is '${mount.name}', but omnidraw.json declares '${String(manifest.name)}'. Create and publish a new widget to rename it.`);
          }
          let acceptedArtifactBuild: 'passed' | 'failed' | 'not-run' = 'not-run';
          if (validation.ok && args.previewBuild) {
            const build = await args.previewBuild({ slug: basename(mount.targetPath) });
            acceptedArtifactBuild = build.ok ? 'passed' : 'failed';
            if (!build.ok) {
              validation.ok = false;
              validation.errors.push(...build.errors);
            }
          }
          await args.onDraftChanged?.({ name: mount.name, type: 'validated' });
          const errors = validation.errors.slice(0, 40);
          const warnings = validation.warnings.slice(0, 40);
          const files = validation.files.slice(0, 100);
          const modelData = {
            name: mount.name,
            mountPath: `widgets/${mount.name}`,
            source: mount.source,
            ok: validation.ok,
            draft: true,
            validationScope: 'source_and_accepted_artifact' as const,
            acceptedArtifactBuild,
            livePreviewRuntime: 'not_exercised' as const,
            resources: 'not_exercised' as const,
            publishReady: false,
            errors,
            warnings,
            files,
            authoredFileCount: validation.files.length,
            errorsTruncated: validation.errors.length > errors.length,
            warningsTruncated: validation.warnings.length > warnings.length,
            filesTruncated: validation.files.length > files.length,
          };
          return fnToolSuccess({
            summary: validation.ok
              ? acceptedArtifactBuild === 'passed'
                ? `Widget '${mount.name}' source is valid and its accepted artifact build passed. Live Preview runtime and resources were not exercised.`
                : `Widget '${mount.name}' source is valid. Accepted artifact build was not run; live Preview runtime and resources were not exercised.`
              : acceptedArtifactBuild === 'failed'
                ? `Widget '${mount.name}' accepted artifact build failed. Live Preview runtime and resources were not exercised.`
                : `Widget '${mount.name}' construction is invalid.`,
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
