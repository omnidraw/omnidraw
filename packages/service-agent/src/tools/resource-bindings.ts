import type { TResourceEffect } from '@omnidraw/resource-runtime';
import type { TWidgetManifestV4 } from '@omnidraw/widget-contract';
import type { TWidgetResourceSelection } from './types';

export type TResourceBindingPlan = {
  slot: string;
  resource: TWidgetResourceSelection;
  scope: ('read' | 'write')[];
};

type TResourceManifest = TWidgetManifestV4;
type TNormalizedRequirement = {
  slot: string;
  kind: TWidgetResourceSelection['kind'];
  required: boolean;
  scope: ('read' | 'write')[];
};

function scopeFromEffect(effect: TResourceEffect): ('read' | 'write')[] {
  if (effect === 'read') return ['read'];
  if (effect === 'write') return ['write'];
  return ['read', 'write'];
}

function requirementsFromManifest(manifest: TResourceManifest): TNormalizedRequirement[] {
  return (manifest.resources ?? []).map((requirement) => ({
    slot: requirement.slot,
    kind: requirement.kind,
    required: requirement.required ?? false,
    scope: scopeFromEffect(requirement.effect),
  }));
}

export function planSelectedResourceBindings(manifest: TResourceManifest, selected: readonly TWidgetResourceSelection[]): { ok: true; bindings: TResourceBindingPlan[] } | { ok: false; message: string } {
  const requirements = requirementsFromManifest(manifest);
  const availableSlots = new Set(requirements.map((requirement) => requirement.slot));
  const bindings: TResourceBindingPlan[] = [];

  for (const resource of selected) {
    if (resource.status !== 'ready') {
      return { ok: false, message: `Selected resource '${resource.name}' is ${resource.status}, not ready.` };
    }
    const exact = requirements.find((requirement) => availableSlots.has(requirement.slot)
      && requirement.kind === resource.kind
      && requirement.slot.toLocaleLowerCase() === resource.name.toLocaleLowerCase());
    const compatible = requirements.filter((requirement) => availableSlots.has(requirement.slot) && requirement.kind === resource.kind);
    const match = exact ?? (compatible.length === 1 ? compatible[0] : undefined);
    if (!match) {
      return {
        ok: false,
        message: `Selected resource '${resource.name}' cannot be mapped safely. Declare exactly one remaining ${resource.kind} slot or name a slot '${resource.name}'.`,
      };
    }
    availableSlots.delete(match.slot);
    bindings.push({ slot: match.slot, resource, scope: [...match.scope] });
  }

  const missingRequired = requirements.find((requirement) => availableSlots.has(requirement.slot) && requirement.required);
  if (missingRequired) {
    return {
      ok: false,
      message: `Required ${missingRequired.kind} resource slot '${missingRequired.slot}' has no selected binding. @mention the intended resource before Preview or Publish.`,
    };
  }

  return { ok: true, bindings };
}

export function planImplicitResourceSelections(manifest: TResourceManifest, available: readonly TWidgetResourceSelection[]): { ok: true; resources: TWidgetResourceSelection[] } | { ok: false; message: string } {
  const resources: TWidgetResourceSelection[] = [];
  const requirements = requirementsFromManifest(manifest);
  for (const kind of ['kv', 'secretStore', 'db'] as const) {
    const slots = requirements.filter((requirement) => requirement.kind === kind);
    if (slots.length === 0) continue;
    const ready = available.filter((resource) => resource.kind === kind && resource.status === 'ready');
    if (slots.length === 1 && ready.length === 1) {
      resources.push(ready[0]);
      continue;
    }
    if (slots.some((requirement) => requirement.required)) {
      if (ready.length === 0) return { ok: false, message: `No ready ${kind} resource is available for required slot '${slots[0]!.slot}'.` };
      return { ok: false, message: `Multiple ${kind} resources or slots are available. Ask the user to @mention the intended resource before publishing.` };
    }
  }
  return { ok: true, resources };
}
