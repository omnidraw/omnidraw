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

  const existing = actorService.listResourceBindingsForDefinition
    ? await actorService.listResourceBindingsForDefinition(args.definitionName)
    : [];
  const desiredSlots = new Set(args.bindings.map((binding) => binding.slot));

  for (const binding of args.bindings) {
    if (!actorService.bindResource) throw new Error('Resource bindings cannot be persisted by this host.');
    await actorService.bindResource({
      definitionName: args.definitionName,
      slot: binding.slot,
      resourceId: binding.resourceId,
      scope: binding.scope,
    });
  }

  for (const binding of existing) {
    if (desiredSlots.has(binding.slot_name)) continue;
    if (!actorService.unbindResource) throw new Error('Removed resource bindings cannot be reconciled by this host.');
    await actorService.unbindResource({ definitionName: args.definitionName, slot: binding.slot_name });
  }
}
