import type { TActorServiceReloader } from './types';

export type TResourceBindingIntent = {
  slot: string;
  resourceId: string;
  scope: ('read' | 'write')[];
};

type TPortal = {
  actorService?: TActorServiceReloader;
};

type TArgs = {
  definitionName: string;
  bindings: readonly TResourceBindingIntent[];
};

export async function txReconcileResourceBindings(portal: TPortal, args: TArgs): Promise<void> {
  const actorService = portal.actorService;
  if (!actorService) return;
  if (!actorService.replaceResourceBindings) {
    if (args.bindings.length === 0 && !actorService.listResourceBindingsForDefinition) return;
    throw new Error('Resource bindings cannot be atomically persisted by this host.');
  }
  await actorService.replaceResourceBindings({
    definitionName: args.definitionName,
    bindings: args.bindings,
  });
}
