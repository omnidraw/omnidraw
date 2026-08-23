# `@omnidraw/theme`

Portable theme contracts, built-in definitions, pure resolution helpers, an
isolated `ThemeService`, and explicitly scoped CSS projection for Omnidraw.

The package has no application, runtime, transport, renderer, Effect, or DOM
singleton dependency. Importing JavaScript never changes a document or injects
styles.

## Scoped application

Import the stylesheet required by the host, mark a caller-owned element, and
apply an isolated theme snapshot to that element only:

```ts
import "@omnidraw/theme/default.css";
import {
  OMNIDRAW_THEME_SCOPE_ATTRIBUTE,
  ThemeService,
  applyThemeToElement,
} from "@omnidraw/theme";

const host = document.querySelector<HTMLElement>("#app")!;
host.setAttribute(OMNIDRAW_THEME_SCOPE_ATTRIBUTE, "application");

const themes = new ThemeService();
applyThemeToElement(host, themes.getTheme());
const release = themes.subscribeThemeChange((theme) => {
  applyThemeToElement(host, theme);
});
```

Canvas hosts import `@omnidraw/theme/canvas.css` and mark each Canvas root with
the same scope attribute. Every projected variable uses the `--omnidraw-*`
namespace, and dark-mode presentation uses `.omnidraw-theme-dark`.

The two CSS entrypoints intentionally contain the same initial variable values,
but they have different owners. `default.css` is the application-shell baseline
and may be imported once by a product root. `canvas.css` is the embeddable Canvas
baseline and belongs with each Canvas host, including consumers that do not use
the Omnidraw application shell. Keeping separate entrypoints prevents Canvas
from acquiring application CSS and permits either baseline to evolve without
silently changing the other consumer surface. Import only the entrypoint owned
by the host; importing both is redundant.

## Release verification

```sh
bun run typecheck
bun run test
bun run build
```
