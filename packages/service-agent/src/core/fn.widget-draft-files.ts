import type { TFunctionName, TVibecanvasJson } from '@vibecanvas/service-actor/core/types';

export function fnWidgetDraftFilesFromManifest(manifest: TVibecanvasJson): TFunctionName[] {
  const functionNames = Object.values(manifest.actor.states).flatMap((state) => {
    if (!state) return [];
    return [
      ...Object.values(state.on).flatMap((transition) => [
        ...(transition?.func ?? []),
        ...(transition?.onError?.func ?? []),
      ]),
      ...(state.onEnter ?? []),
      ...(state.onExit ?? []),
      ...(state.onError?.func ?? []),
      ...(state.activity?.func ?? []),
      ...(state.activity?.onError?.func ?? []),
    ];
  });

  return Array.from(new Set(functionNames));
}
