# `@omnidraw/service-theme`

Public theme definitions, tokens, style helpers, DOM projection helpers, and
an isolated theme-service capability for Omnidraw hosts.

## Service capability

Depend on `IThemeService` at composition boundaries. `ThemeService` is the
default implementation:

```ts
import {
  ThemeService,
  txApplyThemeToElement,
  type IThemeService,
} from "@omnidraw/service-theme";

const theme: IThemeService = new ThemeService();
const release = theme.subscribeThemeChange((definition) => {
  txApplyThemeToElement(canvasHost, definition);
});

txApplyThemeToElement(canvasHost, theme.getTheme());
// Later: release();
```

Apply variables to the host element that owns the themed UI. Importing this
package never changes the document root or installs global styles.

Each `ThemeService` owns its registry, active selection, listeners, and
remembered styles. Creating or changing one instance does not mutate another.
The remembered-style API remains a host capability; it does not replace the
canvas editor's selection-style authority.

## Release verification

```sh
bun run typecheck
bun run test
bun run build
```

The published package contains built ESM and declarations under `dist/` and
has no runtime package dependency.
