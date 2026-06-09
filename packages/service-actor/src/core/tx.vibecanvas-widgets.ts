import type { existsSync, mkdirSync } from 'fs';

type TPortalEnsureWidgetFolder = {
    mkdirSync: typeof mkdirSync,
    existsSync: typeof existsSync
}

type TArgsEnsureWidgetFolder = {
    widgetDir: string
}

export function txEnsureWidgetFolder(portal: TPortalEnsureWidgetFolder, args: TArgsEnsureWidgetFolder) {
    if (!portal.existsSync(args.widgetDir)) {
      portal.mkdirSync(args.widgetDir);
    }
}