/// <reference path="./assets.d.ts" />

import plainManifest from './plain/omnidraw.json.tpl' with { type: 'text' };
import plainPackage from './plain/package.json.tpl' with { type: 'text' };
import plainServer from './plain/server/main.server.ts.tpl' with { type: 'text' };
import plainStyles from './plain/ui/styles.css.tpl' with { type: 'text' };
import plainUi from './plain/ui/main.ts.tpl' with { type: 'text' };
import plainTsconfig from './plain/tsconfig.json.tpl' with { type: 'text' };
import plainViteConfig from './plain/vite.config.mjs.tpl' with { type: 'text' };
import reactManifest from './react/omnidraw.json.tpl' with { type: 'text' };
import reactPackage from './react/package.json.tpl' with { type: 'text' };
import reactServer from './react/server/main.server.ts.tpl' with { type: 'text' };
import reactStyles from './react/ui/styles.css.tpl' with { type: 'text' };
import reactUi from './react/ui/main.tsx.tpl' with { type: 'text' };
import reactTsconfig from './react/tsconfig.json.tpl' with { type: 'text' };
import reactViteConfig from './react/vite.config.mjs.tpl' with { type: 'text' };
import widgetReadme from './README.md.tpl' with { type: 'text' };
import widgetAssetTypes from './assets.d.ts.tpl' with { type: 'text' };

export const WIDGET_TEMPLATE_FILES = {
  plain: {
    'README.md': widgetReadme,
    'omnidraw.json': plainManifest,
    'package.json': plainPackage,
    'vite.config.mjs': plainViteConfig,
    'tsconfig.json': plainTsconfig,
    'ui/assets.d.ts': widgetAssetTypes,
    'ui/main.ts': plainUi,
    'ui/styles.css': plainStyles,
    'server/main.server.ts': plainServer,
  },
  react: {
    'README.md': widgetReadme,
    'omnidraw.json': reactManifest,
    'package.json': reactPackage,
    'vite.config.mjs': reactViteConfig,
    'tsconfig.json': reactTsconfig,
    'ui/assets.d.ts': widgetAssetTypes,
    'ui/main.tsx': reactUi,
    'ui/styles.css': reactStyles,
    'server/main.server.ts': reactServer,
  },
} as const;

export const WIDGET_TEMPLATE_TOKENS = {
  manifest: '__OMNIDRAW_MANIFEST__',
  widgetSlug: '__OMNIDRAW_WIDGET_SLUG__',
  sdkDependency: '__OMNIDRAW_SDK_DEPENDENCY__',
} as const;
