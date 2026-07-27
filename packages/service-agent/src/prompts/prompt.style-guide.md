# Widget style guide

Capsule's native Shadow CSS profile supports custom properties and `var()`
fallbacks for resource-free values. Host custom properties may inherit through
the closed ShadowRoot, but `getWidgetTheme()` and `subscribeWidgetTheme()`
remain the stable semantic theme contract. Keep layout, spacing, typography,
and other static presentation in `ui/styles.css`.

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
- Use custom properties and `var(...)` fallbacks for typed, resource-free
  values such as colors and spacing. Do not use `var()` in image-bearing
  properties or put `url(...)` in a custom property.
- Modern math functions, gradients, logical layout, Grid/Flexbox, typography,
  transitions, animations, media/container queries, and `@supports` are
  available under `shadow-browser-css-v1`.
- Do not use `:host`, `:host-context`, `::slotted`, `::part`, `@property`,
  document-level view transitions, `paint()`, nesting, or runtime `@import`.
- Scope selectors with a root class, for example `.todo-widget`.
- Use `box-sizing: border-box` on the root and descendants.
- Use `width: 100%` and `height: 100%` for canvas-sized widgets.
- Use `overflow: auto` for content that can grow.
- Keep the browser's native visible focus outline. Do not reset it unless the
  replacement has itself passed trusted Capsule validation.
- Prefer bundled assets. Literal HTTPS and root-relative CSS image URLs require
  `css-network-images-v1`; their runtime response bytes are not part of the
  signed artifact.
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
