import { defineTool } from '@earendil-works/pi-coding-agent';
import { execFile } from 'node:child_process';
import { readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { OBJECT_PARAMETER_SCHEMA } from './CONSTANTS';
import { fnToolSuccess } from './fn.result';
import { txValidateWidgetFiles } from '../core/tx.validate-widget-files';
import type { TToolDefinition } from './types';

export type TCreateValidateWidgetFilesToolArgs = {
  cwd: string;
};

export function createValidateWidgetFilesTool(args: TCreateValidateWidgetFilesToolArgs): TToolDefinition {
  return defineTool({
    name: 'vc_validate_widget_files',
    label: 'Validate Widget Files',
    description: 'Validate generated Vibecanvas widget draft files, including vibecanvas.json, actor registry, and required widget files.',
    parameters: OBJECT_PARAMETER_SCHEMA,
    async execute() {
      const validation = await txValidateWidgetFiles({ readdir, readFile, writeFile, rm, execFile, join, relative }, {
        cwd: args.cwd,
        sdkActorTypePath: resolve(import.meta.dir, '../../../sdk/src/actor.ts'),
      });
      const status = validation.ok ? 'valid' : 'invalid';
      return fnToolSuccess(`Widget draft files are ${status}.`, validation);
    },
  }) as TToolDefinition;
}
