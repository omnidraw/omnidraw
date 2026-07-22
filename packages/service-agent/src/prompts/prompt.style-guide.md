# Widget style guide

Widget CSS should use the theme CSS variables provided by Vibecanvas. The host updates these values automatically for light, dark, and custom themes, so widgets should not implement their own theme switcher.

## Use theme variables

Prefer semantic variables over hardcoded colors:

```css
.my-widget {
  background: var(--card);
  color: var(--card-foreground);
  border: 1px solid var(--border);
}
```

Common variables:

- `--background`
- `--foreground`
- `--card`
- `--card-foreground`
- `--popover`
- `--popover-foreground`
- `--muted`
- `--muted-foreground`
- `--primary`
- `--primary-foreground`
- `--secondary`
- `--secondary-foreground`
- `--accent`
- `--accent-foreground`
- `--destructive`
- `--destructive-foreground`
- `--success`
- `--success-foreground`
- `--warning`
- `--warning-foreground`
- `--border`
- `--input`
- `--ring`

Canvas-specific variables may also be available:

- `--vc-canvas-*`
- `--vc-terminal-*`

## Light and dark mode

Do not hardcode separate light/dark palettes. Use the variables; Vibecanvas updates their values automatically.

If you truly need mode-specific tweaks, use the host appearance attribute or dark class only for small adjustments:

```css
.my-widget {
  background: var(--card);
  color: var(--card-foreground);
}

:host-context(.dark) .my-widget,
:host-context([data-theme-appearance="dark"]) .my-widget {
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--border) 70%, transparent);
}
```

Prefer token-based styling first; mode selectors should be rare.

## Widget CSS rules

- Write CSS in `ui/styles.css`.
- Scope selectors with a root class, for example `.todo-widget`.
- Use `box-sizing: border-box` on the root and descendants.
- Use `width: 100%` and `height: 100%` for canvas-sized widgets.
- Use `overflow: auto` for content that can grow.
- Use `--ring` for visible focus states.
- Avoid external fonts and assets unless the user explicitly asks.
- Avoid large fixed pixel widths/heights.

Example:

```css
.todo-widget {
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  padding: 12px;
  overflow: auto;
  background: var(--card);
  color: var(--card-foreground);
  border: 1px solid var(--border);
  font: 14px system-ui, sans-serif;
}

.todo-widget * {
  box-sizing: border-box;
}

.todo-widget button {
  cursor: pointer;
  background: var(--primary);
  color: var(--primary-foreground);
  border: 1px solid var(--border);
}

.todo-widget button:focus-visible,
.todo-widget input:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--ring);
}
```
