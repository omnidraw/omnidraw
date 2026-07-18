import { defineTool } from '@earendil-works/pi-coding-agent';
import { execFile } from 'node:child_process';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { Type } from 'typebox';
import { txValidateWidgetFiles } from '../core/tx.validate-widget-files';
import type { WidgetWorkspace } from '../workspace/WidgetWorkspace';
import type { TWidgetMount } from '../workspace/types';
import { fnBuildWidgetCreateManifest } from './fn.widget-create';
import { fnToolError, fnToolSuccess } from './fn.result';
import { txWriteWidgetScaffold } from './tx.scaffold';
import type { TToolDefinition, TWidgetDraftChange } from './types';

type TCreateWidgetWorkspaceToolsArgs = {
  workspace: WidgetWorkspace;
  chatId: string;
  authorize: (toolName: 'vc_widget_create' | 'vc_widget_validate') => Promise<boolean>;
  onMounted?: (mount: TWidgetMount) => void;
  onDraftChanged?: (change: TWidgetDraftChange) => void | Promise<void>;
};

export function createWidgetWorkspaceTools(args: TCreateWidgetWorkspaceToolsArgs): TToolDefinition[] {
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
      if (!await args.authorize('vc_widget_create')) return fnToolError('This tool call is not authorized.');
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
        return fnToolSuccess(`Created and mounted unpublished widget draft '${created.mount.name}'.`, {
          name: created.mount.name,
          source: created.mount.source,
          files: created.files,
        });
      } catch (error) {
        return fnToolError(error instanceof Error ? error.message : String(error));
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
      if (!await args.authorize('vc_widget_validate')) return fnToolError('This tool call is not authorized.');
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
        return fnToolSuccess(`Widget '${mount.name}' is ${validation.ok ? 'valid' : 'invalid'}.`, {
          name: mount.name,
          source: mount.source,
          ...validation,
          errors: validation.errors.slice(0, 40),
          warnings: validation.warnings.slice(0, 40),
          files: validation.files.slice(0, 500),
        });
      } catch (error) {
        return fnToolError(error instanceof Error ? error.message : String(error));
      }
    },
  }) as TToolDefinition;

  return [create, validate];
}
