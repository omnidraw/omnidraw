import type { TVibecanvasJson } from '@vibecanvas/service-actor/core/types';
import type { TWidgetResourceSelection } from './types';

export type TResourceBindingPlan = {
  slot: string;
  resource: TWidgetResourceSelection;
  scope: ('read' | 'write')[];
};

export function planSelectedResourceBindings(manifest: TVibecanvasJson, selected: readonly TWidgetResourceSelection[]): { ok: true; bindings: TResourceBindingPlan[] } | { ok: false; message: string } {
  const requirements = Object.entries(manifest.actor.resources ?? {});
  const availableSlots = new Set(requirements.map(([slot]) => slot));
  const bindings: TResourceBindingPlan[] = [];

  for (const resource of selected) {
    if (resource.status !== 'ready') {
      return { ok: false, message: `Selected resource '${resource.name}' is ${resource.status}, not ready.` };
    }
    const exact = requirements.find(([slot, requirement]) => availableSlots.has(slot)
      && requirement.kind === resource.kind
      && slot.toLocaleLowerCase() === resource.name.toLocaleLowerCase());
    const compatible = requirements.filter(([slot, requirement]) => availableSlots.has(slot) && requirement.kind === resource.kind);
    const match = exact ?? (compatible.length === 1 ? compatible[0] : undefined);
    if (!match) {
      return {
        ok: false,
        message: `Selected resource '${resource.name}' cannot be mapped safely. Declare exactly one remaining ${resource.kind} slot or name a slot '${resource.name}'.`,
      };
    }
    const [slot, requirement] = match;
    availableSlots.delete(slot);
    bindings.push({ slot, resource, scope: [...requirement.scope] });
  }

  const missingRequired = requirements.find(([slot, requirement]) => availableSlots.has(slot) && requirement.required);
  if (missingRequired) {
    const [slot, requirement] = missingRequired;
    return {
      ok: false,
      message: `Required ${requirement.kind} resource slot '${slot}' has no selected binding. @mention the intended resource before Preview or Publish.`,
    };
  }

  return { ok: true, bindings };
}

export function planImplicitResourceSelections(manifest: TVibecanvasJson, available: readonly TWidgetResourceSelection[]): { ok: true; resources: TWidgetResourceSelection[] } | { ok: false; message: string } {
  const resources: TWidgetResourceSelection[] = [];
  const requirements = Object.entries(manifest.actor.resources ?? {});
  for (const kind of ['kv', 'secretStore', 'db'] as const) {
    const slots = requirements.filter(([, requirement]) => requirement.kind === kind);
    if (slots.length === 0) continue;
    const ready = available.filter((resource) => resource.kind === kind && resource.status === 'ready');
    if (slots.length === 1 && ready.length === 1) {
      resources.push(ready[0]);
      continue;
    }
    if (slots.some(([, requirement]) => requirement.required)) {
      if (ready.length === 0) return { ok: false, message: `No ready ${kind} resource is available for required slot '${slots[0][0]}'.` };
      return { ok: false, message: `Multiple ${kind} resources or slots are available. Ask the user to @mention the intended resource before publishing.` };
    }
  }
  return { ok: true, resources };
}
