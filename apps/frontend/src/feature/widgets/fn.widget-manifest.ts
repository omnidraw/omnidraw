import type { TWidgetDetail } from '@vibecanvas/orpc-client';

export type TWidgetInputMessageRow = {
  name: string;
  schema: unknown;
  acceptedInStates: string[];
};

export type TWidgetOutputMessageRow = {
  name: string;
  schema: unknown;
};

export function fnWidgetMessageRows(manifest: TWidgetDetail['manifest']): {
  inputs: TWidgetInputMessageRow[];
  outputs: TWidgetOutputMessageRow[];
} {
  if (!manifest) return { inputs: [], outputs: [] };
  const acceptedStates = new Map<string, string[]>();
  for (const [stateName, state] of Object.entries(manifest.actor.states)) {
    for (const messageName of Object.keys(state?.on ?? {})) {
      const states = acceptedStates.get(messageName) ?? [];
      states.push(stateName);
      acceptedStates.set(messageName, states);
    }
  }
  const inputs = Object.entries(manifest.actor.inputMsgSchema ?? {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, schema]) => ({
      name,
      schema,
      acceptedInStates: (acceptedStates.get(name) ?? []).sort((left, right) => left.localeCompare(right)),
    }));
  const outputs = Object.entries(manifest.actor.outputMsgSchema ?? {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, schema]) => ({ name, schema }));
  return { inputs, outputs };
}
