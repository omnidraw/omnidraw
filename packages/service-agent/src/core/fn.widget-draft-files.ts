import type { TFunctionName, TVibecanvasJson } from '@vibecanvas/service-actor/core/types';

export function fnWidgetDraftFilesFromManifest(manifest: TVibecanvasJson): TFunctionName[] {
  return Array.from(new Set(Object.values(manifest.actor.states).flatMap((state) => Object.values(state?.on ?? {}).flatMap((transition) => transition?.func ?? []))));
}
