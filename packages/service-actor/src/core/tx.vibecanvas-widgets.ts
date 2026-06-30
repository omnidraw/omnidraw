import type { existsSync, mkdirSync } from 'fs';

type TPortalEnsureWidgetFolder = {
    mkdirSync: typeof mkdirSync,
    existsSync: typeof existsSync
}

type TArgsEnsureWidgetFolder = {
    absWidgetDir: string
}

export function txEnsureWidgetFolder(portal: TPortalEnsureWidgetFolder, args: TArgsEnsureWidgetFolder) {
    if (!portal.existsSync(args.absWidgetDir)) {
      portal.mkdirSync(args.absWidgetDir, { recursive: true });
    }
}
