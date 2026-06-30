# Vibecanvas Style Guide

Terminal-like design system. No Tailwind.

Use plain CSS. Prefer local `*.module.css` files next to components.

## Source of truth

Theme tokens come from `@vibecanvas/service-theme`.

Main files:
- `packages/service-theme/src/ThemeService.ts`
- `packages/service-theme/src/dom.ts`
- `apps/frontend/src/services/theme.ts`

`ThemeService` owns theme registry and active theme.
Frontend calls `txApplyThemeToElement(document.documentElement, theme)`.
That writes CSS variables on `:root`, sets:
- `data-theme-id`
- `data-theme-appearance`
- `.dark` when appearance is dark

Do not invent parallel theme systems.
Use the CSS variables already emitted by `ThemeService`.

## Built-in themes

Current built-ins:
- `light`
- `dark`
- `sepia`
- `graphite`

`light` is default.

## Theme tokens

UI CSS should read semantic variables, not hardcoded palette classes.

Core tokens:
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

Canvas and terminal tokens also come from `ThemeService`:
- `--vc-canvas-*`
- `--vc-terminal-*`

Read `packages/service-theme/src/dom.ts` for full mapping.

## Styling rules

### 1. No Tailwind utility strings

Bad:

```tsx
<button class="bg-primary text-primary-foreground px-4 py-2" />
```

Good:

```tsx
import styles from "./Button.module.css";

<button class={styles.primaryButton} />
```

```css
.primaryButton {
  padding: 0.5rem 1rem;
  border: 1px solid transparent;
  background: var(--primary);
  color: var(--primary-foreground);
}
```

### 2. Keep CSS local

Prefer component-local CSS modules:
- `Sidebar.tsx` + `Sidebar.module.css`
- `Toast.tsx` + `Toast.module.css`
- dialog component + dialog css module

Only keep global CSS in `apps/frontend/src/index.css` for:
- resets
- font vars
- fallback theme vars before ThemeService runs

### 3. Use semantic tokens

Good:

```css
.panel {
  background: var(--card);
  color: var(--card-foreground);
  border: 1px solid var(--border);
}
```

Avoid raw light/dark conditionals when a token already exists.

### 4. Style Kobalte with local selectors

Kobalte is unstyled.
Style parts directly.
Use state attributes in CSS.

Example:

```css
.menuItem[data-highlighted] {
  background: var(--accent);
  color: var(--accent-foreground);
}

.toggle[data-pressed] {
  background: color-mix(in srgb, var(--primary) 15%, var(--secondary));
}
```

Useful Kobalte attrs:
- `data-expanded`
- `data-highlighted`
- `data-pressed`
- `data-disabled`
- `data-selected`
- `data-invalid`

### 5. Focus is visible

Interactive elements must show focus.
Use `--ring` for focus styling.

```css
.button:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--ring);
}
```

### 6. Radius stays square

Terminal look stays sharp.
Do not add rounded corners unless design changes on purpose.

## Current visual language

- monospace display and body text
- stone/amber-like terminal palette, but exposed through semantic variables
- bordered flat surfaces
- square corners
- strong focus ring
- subtle motion only

## Kobalte notes

- Prefer subpath imports like `@kobalte/core/dialog`
- Compose parts explicitly
- Use `Portal` for overlays when component expects it
- For menu and dialog state styling, target `data-*` attrs in CSS
- Avoid modal behavior for small anchored menus unless needed

## Quick recipes

### Primary button

```css
.primaryButton {
  padding: 0.5rem 1rem;
  border: 1px solid transparent;
  background: var(--primary);
  color: var(--primary-foreground);
}

.primaryButton:hover:not(:disabled) {
  background: color-mix(in srgb, var(--primary) 88%, black);
}
```

### Secondary button

```css
.secondaryButton {
  padding: 0.5rem 1rem;
  border: 1px solid var(--border);
  background: var(--secondary);
  color: var(--secondary-foreground);
}

.secondaryButton:hover:not(:disabled) {
  background: var(--accent);
}
```

### Dialog shell

```css
.content {
  border: 1px solid var(--border);
  background: var(--popover);
  color: var(--popover-foreground);
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.18);
}
```

### Selected sidebar item

```css
.selected {
  background: color-mix(in srgb, var(--foreground) 12%, var(--card));
}
```
