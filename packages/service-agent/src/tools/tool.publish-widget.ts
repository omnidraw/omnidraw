import { defineTool } from '@earendil-works/pi-coding-agent';
import { cp, mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { basename, join, relative, resolve } from 'node:path';
import { fnToolError, fnToolSuccess } from './fn.result';
import { txPublishWidgetDraft } from '../core/tx.publish-widget-draft';
import type { TActorServiceReloader, TToolDefinition, TToolEventSink } from './types';

export type TCreatePublishWidgetToolArgs = {
  cwd: string;
  finalWidgetsDir: string;
  actorService?: TActorServiceReloader;
  onEvent?: TToolEventSink;
};

export function createPublishWidgetTool(args: TCreatePublishWidgetToolArgs): TToolDefinition {
  return defineTool({
    name: 'vc_publish_widget',
    label: 'Publish Widget',
    description: 'Publish the generated widget draft to the Vibecanvas widgets directory and reload the actor service definitions.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        confirm: {
          type: 'boolean',
          description: 'Must be true to publish generated files.',
        },
      },
      required: ['confirm'],
    } as any,
    async execute(_toolCallId, params: any) {
      if (params.confirm !== true) {
        return fnToolError('Publish requires confirm: true.', { published: false });
      }

      // TODO: must run validation first

      const result = await txPublishWidgetDraft({ readdir, readFile, mkdir, rm, cp, join, relative, resolve, basename }, {
        cwd: args.cwd,
        finalWidgetsDir: args.finalWidgetsDir,
        actorService: args.actorService,
      });

      if (!result.published) {
        return fnToolError('Widget draft is invalid and was not published.', result);
      }

      await args.onEvent?.({ type: 'widgetupdate', cwd: result.destination ?? args.cwd, files: result.files });

      return fnToolSuccess(`Published widget '${result.manifest.name}' to ${result.destination}.`, result);
    },
  }) as TToolDefinition;
}
