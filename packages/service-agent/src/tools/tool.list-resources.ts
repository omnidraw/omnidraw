import { defineTool } from '@earendil-works/pi-coding-agent';
import { fxLatestWidgetResourceSelectionRecord } from '../core/fx.session-candidate';
import { fnToolError, fnToolSuccess } from './fn.result';
import type { TActorServiceReloader, TCandidateSessionManager, TToolDefinition } from './types';

export type TCreateListResourcesToolArgs = {
  actorService?: TActorServiceReloader;
  sessionManager: TCandidateSessionManager;
};

export function createListResourcesTool(args: TCreateListResourcesToolArgs): TToolDefinition {
  return defineTool({
    name: 'vc_list_resources',
    label: 'List Vibecanvas Resources',
    description: 'List available host resources and mark resources explicitly selected with @mentions. Returns safe metadata only; never paths, credentials, or secret values.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        kind: { type: 'string', enum: ['kv', 'secretStore', 'db'], description: 'Optional resource-kind filter.' },
      },
    } as any,
    async execute(_toolCallId, params: any) {
      if (!args.actorService?.listResources) {
        return fnToolError('Resource discovery is unavailable in this host.', { resources: [] });
      }

      const kind = params?.kind;
      const resources = await args.actorService.listResources(kind ? { kind } : {});
      const selected = fxLatestWidgetResourceSelectionRecord({ sessionManager: args.sessionManager }, { });
      const selectedIds = new Set(selected?.resources.map((resource) => resource.id) ?? []);
      const safeResources = resources.slice(0, 100).map((resource) => ({
        id: resource.id,
        kind: resource.kind,
        name: resource.name,
        status: resource.status,
        selected: selectedIds.has(resource.id),
      }));
      const resourceText = safeResources.map((resource) => (
        `- id=${JSON.stringify(resource.id)} name=${JSON.stringify(resource.name)} kind=${resource.kind} status=${resource.status} selected=${resource.selected}`
      )).join('\n');

      return fnToolSuccess(
        safeResources.length === 0
          ? 'No Vibecanvas resources are available for this filter.'
          : `Found ${safeResources.length} Vibecanvas resource${safeResources.length === 1 ? '' : 's'}. Resources marked selected were explicitly @mentioned by the user. Use the exact id value for vc_inspect_resource.\n${resourceText}`,
        { resources: safeResources, truncated: resources.length > safeResources.length },
      );
    },
  }) as TToolDefinition;
}
