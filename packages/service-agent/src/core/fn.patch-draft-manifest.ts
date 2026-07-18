import type { TVibecanvasToolIcon } from '@vibecanvas/service-actor/core/tool-icon';
import type { TVibecanvasJson } from '@vibecanvas/service-actor/core/types';

export type TWidgetManifestPatch = {
  name?: string;
  description?: string;
  initialData?: unknown;
  dataSchema?: unknown;
  tool?: {
    label?: string;
    icon?: TVibecanvasToolIcon | null;
    group?: string | null;
    priority?: number | null;
  };
};

export type TWidgetManifestPatchPlan = {
  manifest: unknown;
  issues: string[];
};

export function fnPatchDraftManifest(args: {
  manifest: TVibecanvasJson;
  patch: TWidgetManifestPatch;
}): TWidgetManifestPatchPlan {
  const issues: string[] = [];
  let tool = args.manifest.widget.tool;

  if (args.patch.tool) {
    const patch = args.patch.tool;
    if (typeof patch.label === 'string') tool = { ...tool, label: patch.label };
    if ('icon' in patch) tool = { ...tool, icon: patch.icon ?? undefined };
    if ('group' in patch) tool = { ...tool, group: patch.group ?? undefined };
    if ('priority' in patch) tool = { ...tool, priority: patch.priority ?? undefined };
    if (patch.label === undefined && !('icon' in patch) && !('group' in patch) && !('priority' in patch)) {
      issues.push('widget.tool: no editable field supplied');
    }
  }

  return {
    issues,
    manifest: {
      ...args.manifest,
      name: args.patch.name ?? args.manifest.name,
      description: args.patch.description ?? args.manifest.description,
      actor: {
        ...args.manifest.actor,
        initialData: 'initialData' in args.patch ? args.patch.initialData : args.manifest.actor.initialData,
        dataSchema: 'dataSchema' in args.patch ? args.patch.dataSchema : args.manifest.actor.dataSchema,
      },
      widget: {
        ...args.manifest.widget,
        tool,
      },
    },
  };
}
