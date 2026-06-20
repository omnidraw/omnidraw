import type { existsSync, mkdirSync } from 'fs';

type TPortalEnsureWidgetFolder = {
    mkdirSync: typeof mkdirSync,
    existsSync: typeof existsSync
}

type TArgsEnsureWidgetFolder = {
    ablWidgetDir: string
}

export function txEnsureWidgetFolder(portal: TPortalEnsureWidgetFolder, args: TArgsEnsureWidgetFolder) {
    if (!portal.existsSync(args.ablWidgetDir)) {
      portal.mkdirSync(args.ablWidgetDir);
    }
}