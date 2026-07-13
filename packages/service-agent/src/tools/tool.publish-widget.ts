import { defineTool } from '@earendil-works/pi-coding-agent';
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, join, relative, resolve } from 'node:path';
import { fnToolError, fnToolSuccess } from './fn.result';
import { txPublishWidgetDraft } from '../core/tx.publish-widget-draft';
import { fxLatestWidgetResourceSelectionRecord } from '../core/fx.session-candidate';
import type { TVibecanvasJson } from '@vibecanvas/service-actor/core/types';
import { planImplicitResourceSelections, planSelectedResourceBindings } from './resource-bindings';
import type { TActorServiceReloader, TCandidateSessionManager, TToolDefinition, TToolEventSink, TWidgetEditSessionRecord } from './types';

export type TCreatePublishWidgetToolArgs = {
  cwd: string;
  finalWidgetsDir: string;
  actorService?: TActorServiceReloader;
  sessionManager?: TCandidateSessionManager;
  editSession?: TWidgetEditSessionRecord;
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

      const selectionRecord = args.sessionManager
        ? fxLatestWidgetResourceSelectionRecord({ sessionManager: args.sessionManager }, {})
        : null;
      const draftManifest = JSON.parse(await readFile(join(args.cwd, 'vibecanvas.json'), 'utf8')) as TVibecanvasJson;
      let selectedResources = selectionRecord?.resources ?? [];
      if (selectedResources.length === 0 && Object.keys(draftManifest.actor.resources ?? {}).length > 0) {
        if (!args.actorService?.listResources) {
          return fnToolError('Resources cannot be discovered in this host. The widget was not published.', { published: false, bindings: [] });
        }
        const available = await args.actorService.listResources({ status: 'ready' });
        const implicit = planImplicitResourceSelections(draftManifest, available.map((resource) => ({
          id: resource.id,
          kind: resource.kind,
          name: resource.name,
          status: resource.status,
        })));
        if (!implicit.ok) return fnToolError(`${implicit.message} The widget was not published.`, { published: false, bindings: [] });
        selectedResources = implicit.resources;
      }
      const bindingPlan = planSelectedResourceBindings(draftManifest, selectedResources);
      if (!bindingPlan.ok) {
        return fnToolError(`${bindingPlan.message} The widget was not published.`, { published: false, bindings: [] });
      }
      if (bindingPlan.bindings.length > 0 && !args.actorService?.bindResource) {
        return fnToolError('Selected resources cannot be bound in this host. The widget was not published.', { published: false, bindings: [] });
      }

      // TODO: must run validation first

      const result = await txPublishWidgetDraft({ readdir, readFile, writeFile, mkdir, rm, cp, join, relative, resolve, basename }, {
        cwd: args.cwd,
        finalWidgetsDir: args.finalWidgetsDir,
        actorService: args.editSession ? undefined : args.actorService,
      });

      if (!result.published) {
        return fnToolError('Widget draft is invalid and was not published.', result);
      }

      const shouldReloadEditedInstances = args.editSession !== undefined
        && args.editSession.sourceName === result.manifest.name
        && args.editSession.sourceSlug === result.manifest.slug;

      if (args.editSession) {
        await args.actorService?.reload();
      }
      const bindings: Array<{ slot: string; resourceId: string; resourceName: string; kind: string }> = [];
      for (const binding of bindingPlan.bindings) {
        await args.actorService?.bindResource?.({
          definitionName: result.manifest.name,
          slot: binding.slot,
          resourceId: binding.resource.id,
          scope: binding.scope,
        });
        bindings.push({
          slot: binding.slot,
          resourceId: binding.resource.id,
          resourceName: binding.resource.name,
          kind: binding.resource.kind,
        });
      }
      if (shouldReloadEditedInstances) {
        await args.actorService?.reloadDefinitionInstances?.(args.editSession!.sourceDefinitionName);
      }
      await args.onEvent?.({ type: 'widgetupdate', cwd: result.destination ?? args.cwd, files: result.files });

      const bindingText = bindings.length > 0
        ? ` Bound ${bindings.map((binding) => `'${binding.resourceName}' as ${binding.slot}`).join(', ')}.`
        : '';
      return fnToolSuccess(`Published widget '${result.manifest.name}' to ${result.destination}.${bindingText}`, { ...result, bindings });
    },
  }) as TToolDefinition;
}
