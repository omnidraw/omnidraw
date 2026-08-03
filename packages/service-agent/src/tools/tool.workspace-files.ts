import { createReadToolDefinition, defineTool } from '@earendil-works/pi-coding-agent';
import { constants } from 'node:fs';
import { execFile } from 'node:child_process';
import {
  access,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { Type } from 'typebox';
import type { WidgetWorkspace } from '../workspace/WidgetWorkspace';
import { fnApplyExactEdits } from './fn.apply-exact-edits';
import { fnApplyUnifiedPatch } from './fn.apply-unified-patch';
import { fnToolError, fnToolSuccess } from './fn.result';
import type { TToolDefinition, TWidgetDraftChangeHandler } from './types';
import {
  txRestoreNpmPackageLock,
  txTryNpmInstall,
  type TNpmInstall,
  type TNpmPackageLockState,
} from './tx.npm-install';

type TCreateWorkspaceFileToolsArgs = {
  workspace: WidgetWorkspace;
  chatId: string;
  cwd: string;
  authorize: (toolName: 'read' | 'edit' | 'patch' | 'grep') => Promise<boolean>;
  onDraftChanged?: TWidgetDraftChangeHandler;
  npmInstall?: TNpmInstall;
};

function mountedWidgetName(path: string): string | undefined {
  const [root, name] = path.split('/');
  return root === 'widgets' && name ? name : undefined;
}

function lexicalPath(cwd: string, absolutePath: string): string {
  return relative(cwd, absolutePath).split(sep).join('/');
}

async function installManifestChange(
  args: Pick<TCreateWorkspaceFileToolsArgs, 'chatId' | 'workspace' | 'npmInstall'>,
  name: string,
): Promise<void> {
  const mount = await args.workspace.findMountedWidget(args.chatId, name);
  await args.workspace.prepareNpmDependencies();
  const result = await (args.npmInstall
    ? args.npmInstall(mount.targetPath)
    : txTryNpmInstall({ access, execFile, join }, {
        cwd: mount.targetPath,
        userConfigPath: args.workspace.npmUserConfigPath,
      }));
  if (result.status !== 'success') {
    throw new Error(result.status === 'error'
      ? `Dependency installation failed: ${result.message}`
      : `Dependency installation was skipped: ${result.reason}`);
  }
}

async function capturePackageLockState(
  args: Pick<TCreateWorkspaceFileToolsArgs, 'chatId' | 'workspace'>,
  name: string,
): Promise<TNpmPackageLockState> {
  const mount = await args.workspace.findMountedWidget(args.chatId, name);
  const path = join(mount.targetPath, 'package-lock.json');
  try {
    return { path, bytes: new Uint8Array(await readFile(path)) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { path, bytes: null };
    }
    throw error;
  }
}

async function rollbackManifestChange(
  args: Pick<TCreateWorkspaceFileToolsArgs, 'chatId' | 'workspace'>,
  rollback: Readonly<{
    name: string;
    manifestPath: string;
    previousSource: string;
    packageLock: TNpmPackageLockState;
  }>,
): Promise<void> {
  await args.workspace.updateMountedFileAtomic(
    args.chatId,
    rollback.manifestPath,
    () => ({ content: rollback.previousSource, value: undefined }),
  );
  let recoveryError: unknown;
  try {
    await installManifestChange(args, rollback.name);
  } catch (error) {
    recoveryError = error;
  }
  let dependencyCleanupError: unknown;
  if (recoveryError !== undefined) {
    try {
      await rm(join(dirname(rollback.packageLock.path), 'node_modules'), {
        recursive: true,
        force: true,
      });
    } catch (error) {
      dependencyCleanupError = error;
    }
  }
  let lockfileRollbackError: unknown;
  try {
    await txRestoreNpmPackageLock({ writeFile, rename, rm }, {
      state: rollback.packageLock,
    });
  } catch (error) {
    lockfileRollbackError = error;
  }
  if (dependencyCleanupError !== undefined || lockfileRollbackError !== undefined) {
    throw new AggregateError(
      [dependencyCleanupError, lockfileRollbackError]
        .filter((value) => value !== undefined),
      'The previous package manifest was restored, but its dependency-state rollback failed.',
    );
  }
}

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
      if (!await args.authorize('edit')) return fnToolError({ code: 'TOOL_NOT_AUTHORIZED', message: 'This tool call is not authorized.' });
      const name = mountedWidgetName(params.path);
      let sourceChanged = false;
      try {
        const execute = async () => {
          if (JSON.stringify(params.edits).length > 2_000_000) throw new Error('Edit batch exceeds the total request-size limit.');
          const packageLock = name && params.path === `widgets/${name}/package.json`
            ? await capturePackageLockState(args, name)
            : undefined;
          let previousSource = '';
          await args.workspace.updateMountedFileAtomic(args.chatId, params.path, (source) => {
            previousSource = source;
            const result = fnApplyExactEdits(source, params.edits);
            if (!result.ok) throw new Error(result.message);
            return { content: result.content, value: undefined };
          });
          sourceChanged = true;
          if (name && params.path === `widgets/${name}/package.json`) {
            try {
              await installManifestChange(args, name);
            } catch (error) {
              try {
                await rollbackManifestChange(args, {
                  name,
                  manifestPath: params.path,
                  previousSource,
                  packageLock: packageLock!,
                });
                sourceChanged = false;
              } catch (rollbackError) {
                throw new AggregateError(
                  [error, rollbackError],
                  'Dependency installation failed and rollback did not complete.',
                );
              }
              throw error;
            }
          }
          if (name) {
            const durable = await args.onDraftChanged?.({ name, type: 'changed' });
            if (args.onDraftChanged && !durable) {
              throw new Error('Edited widget source did not receive a durable mutation fence.');
            }
          }
          const modelData = {
            path: params.path,
            replacements: params.edits.length,
          };
          return fnToolSuccess({
            summary: `Successfully replaced ${params.edits.length} block(s) in ${params.path}.`,
            modelData,
            details: modelData,
          });
        };
        return name
          ? await args.workspace.withDraftAuthoringOperation(name, execute)
          : await execute();
      } catch (error) {
        return fnToolError({
          code: 'EDIT_FAILED',
          message: error instanceof Error ? error.message : String(error),
          ...(sourceChanged ? { modelData: { path: params.path, sourceChanged: true } } : {}),
        });
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
      if (!await args.authorize('patch')) return fnToolError({ code: 'TOOL_NOT_AUTHORIZED', message: 'This tool call is not authorized.' });
      const name = mountedWidgetName(params.path);
      let sourceChanged = false;
      try {
        const execute = async () => {
          const packageLock = name && params.path === `widgets/${name}/package.json`
            ? await capturePackageLockState(args, name)
            : undefined;
          let previousSource = '';
          await args.workspace.updateMountedFileAtomic(args.chatId, params.path, (source) => {
            previousSource = source;
            const result = fnApplyUnifiedPatch(source, params.patch);
            if (!result.ok) throw new Error(result.message);
            return { content: result.content, value: undefined };
          }, { allowMissing: true });
          sourceChanged = true;
          if (name && params.path === `widgets/${name}/package.json`) {
            try {
              await installManifestChange(args, name);
            } catch (error) {
              try {
                await rollbackManifestChange(args, {
                  name,
                  manifestPath: params.path,
                  previousSource,
                  packageLock: packageLock!,
                });
                sourceChanged = false;
              } catch (rollbackError) {
                throw new AggregateError(
                  [error, rollbackError],
                  'Dependency installation failed and rollback did not complete.',
                );
              }
              throw error;
            }
          }
          if (name) {
            const durable = await args.onDraftChanged?.({ name, type: 'changed' });
            if (args.onDraftChanged && !durable) {
              throw new Error('Patched widget source did not receive a durable mutation fence.');
            }
          }
          const modelData = { path: params.path };
          return fnToolSuccess({ summary: `Applied patch to ${params.path}.`, modelData, details: modelData });
        };
        return name
          ? await args.workspace.withDraftAuthoringOperation(name, execute)
          : await execute();
      } catch (error) {
        return fnToolError({
          code: 'PATCH_FAILED',
          message: error instanceof Error ? error.message : String(error),
          ...(sourceChanged ? { modelData: { path: params.path, sourceChanged: true } } : {}),
        });
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
      if (!await args.authorize('grep')) return fnToolError({ code: 'TOOL_NOT_AUTHORIZED', message: 'This tool call is not authorized.' });
      try {
        const result = await args.workspace.grepMountedFiles(args.chatId, params);
        const text = result.matches.length === 0
          ? 'No matches found.'
          : result.matches.map((match) => `${match.path}:${match.line}: ${match.text}`).join('\n');
        return fnToolSuccess({
          summary: `${text}${result.truncated ? '\n\n[Results truncated by host bounds.]' : ''}`,
          modelData: result,
          details: result,
        });
      } catch (error) {
        return fnToolError({ code: 'GREP_FAILED', message: error instanceof Error ? error.message : String(error) });
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
