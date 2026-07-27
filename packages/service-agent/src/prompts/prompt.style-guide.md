# Widget style guide

Capsule does not admit CSS custom-property references such as
`var(--foreground)`. Read the bounded semantic theme from
`@vibecanvas/sdk/widget`, apply color tokens through inline style properties,
and subscribe to theme changes. Keep layout, spacing, typography, and other
static presentation in `ui/styles.css`.

## Use the theme channel

```ts
import { getWidgetTheme, subscribeWidgetTheme } from "@vibecanvas/sdk/widget";
import "./styles.css";

const root = document.createElement("section");
root.className = "my-widget";

const applyTheme = () => {
  const { tokens } = getWidgetTheme();
  root.style.backgroundColor = tokens.surface;
  root.style.color = tokens.surfaceForeground;
  root.style.borderColor = tokens.border;
};

applyTheme();
subscribeWidgetTheme(applyTheme);
```

Available semantic tokens:

- `background`
- `foreground`
- `surface`
- `surfaceForeground`
- `muted`
- `mutedForeground`
- `primary`
- `primaryForeground`
- `accent`
- `accentForeground`
- `destructive`
- `success`
- `border`

For React, initialize component state from `getWidgetTheme()` and update it
from `subscribeWidgetTheme()` inside an effect. Apply token values through the
React `style` prop. Do not invent theme values or read host DOM attributes.

## Light and dark mode

Do not hardcode separate light/dark palettes. The theme channel exposes
`appearance: "light" | "dark"` and sends a new semantic token projection when
the host theme changes.

## Widget CSS rules

- Write static CSS in `ui/styles.css`.
- Do not use CSS custom properties, `var(...)`, `:host-context`, or host theme
  selectors; the trusted Capsule CSS transform rejects or isolates them.
- Scope selectors with a root class, for example `.todo-widget`.
- Use `box-sizing: border-box` on the root and descendants.
- Use `width: 100%` and `height: 100%` for canvas-sized widgets.
- Use `overflow: auto` for content that can grow.
- Keep the browser's native visible focus outline. Do not reset it unless the
  replacement has itself passed trusted Capsule validation.
- Avoid external fonts and assets unless the user explicitly asks.
- Avoid large fixed pixel widths or heights.

Example:

```css
.todo-widget {
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  padding: 12px;
  overflow: auto;
  border: 1px solid;
  font: 14px system-ui, sans-serif;
}

.todo-widget * {
  box-sizing: border-box;
}

.todo-widget button {
  cursor: pointer;
  border: 1px solid;
}

```
