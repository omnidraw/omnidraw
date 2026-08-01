# `@omnidraw/service-theme`

Public theme definitions, tokens, style helpers, DOM projection helpers, and
an isolated theme-service capability for Omnidraw hosts.

Every registration is one complete definition: detailed UI and interaction
roles, the six role-aware canvas colors, viewport and editor affordances, and
terminal colors. A registration may instead explicitly extend an existing
theme. Unknown theme IDs and unknown inheritance bases throw; they never
silently borrow the Light canvas palette.

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

Import `@omnidraw/service-theme/default.css` for generated document defaults or
`@omnidraw/service-theme/canvas-default.css` for package-scoped canvas defaults.
Both files are generated from the Light definition during the package build;
runtime DOM application still uses one immutable ThemeService snapshot.

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

The published package contains built ESM, declarations, and generated CSS
under `dist/`. Its only runtime dependency is the state-free
`@omnidraw/theme-contract` package.
