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

## Brand visual language

Vibecanvas looks like a precise desktop tool built from terminal and early workstation UI ideas, not like a generic SaaS dashboard. The canvas is spacious and quiet; controls are compact, flat, typographic, and visibly constructed from lines and rectangular surfaces.

Reference screenshots show the intended light-theme character:

- warm off-white and stone surfaces rather than pure blue-gray application chrome
- near-black text and strokes
- amber/orange as the identifying interaction color
- pale amber for selected rows, active tabs, and low-emphasis highlights
- red only for destructive actions; green only for success/status indicators
- a visible square grid behind canvas content
- floating tools that resemble small desktop windows, with thin title bars and hard rectangular edges
- monospace text everywhere, including labels, inputs, tabs, buttons, headings, and shortcuts

The style should feel **utilitarian, handmade, direct, and slightly retro**, while remaining accessible and uncluttered. It should not feel glossy, soft, luxurious, playful, or mobile-first.

### Shape and surface

- Use square corners (`border-radius: 0`) by default on menus, dialogs, buttons, fields, tabs, panels, and canvas windows.
- Build hierarchy with one-pixel borders, background changes, spacing, and type weight—not radius, gradients, glass blur, or large shadows.
- Use `1px solid var(--border)` for ordinary shells and separators.
- Important action buttons may use a `2px` border. The stronger stroke is intentional and gives controls a physical, printed quality.
- Keep surfaces flat. A shadow is reserved for a floating layer such as a menu, dialog, or canvas window. Use a restrained dark shadow such as `0 10px 24px rgb(0 0 0 / 0.18)`.
- Do not use gradients, glassmorphism, translucent blur, pill shapes, bubbly cards, or decorative shadows.
- Avoid nesting many card-like boxes. Prefer sections separated by rules, whitespace, or a changed surface token.

### Color hierarchy

Always express these roles with semantic theme tokens:

1. **Workspace:** `--background`, or `--vc-canvas-background` for the infinite canvas.
2. **Persistent chrome/panels:** `--card` and `--card-foreground`.
3. **Floating layers:** `--popover` and `--popover-foreground`.
4. **Quiet areas and inactive controls:** `--muted`, `--muted-foreground`, or `--secondary`.
5. **Brand interaction:** `--primary` for active borders, underlines, selection edges, and important accents. Do not flood every primary button with amber; an outlined light button with a primary border is often more on-brand.
6. **Soft active state:** `--accent` and `--accent-foreground`, or a light mix of primary into background.
7. **Danger/status:** `--destructive`, `--success`, and `--warning` only for their semantic meanings.

On the canvas, amber should help locate the current action without competing with user-created content. Most chrome stays neutral. A single active tab underline, selected row border, tool highlight, or focused field is enough.

### Typography

- The application font is `var(--font-mono)`; display text uses `var(--font-display)`, which currently resolves to the same monospace stack.
- Do not introduce a proportional UI font for newly generated UI.
- Default control and menu text is compact: about `0.75rem`–`0.875rem` with `1rem`–`1.25rem` line height.
- Use weight and case to establish hierarchy. Titles and primary labels are bold; descriptions and shortcuts are regular and quieter.
- Short structural labels may be uppercase, such as `TOOLS`, `CANVASES`, or `SETTINGS`. Do not uppercase long sentences.
- Headings are not oversized. A dialog title around `1rem` can still feel prominent through weight and spacing.
- Keep labels literal and concise. Prefer `Rename`, `Delete canvas`, and `Add card` over conversational marketing copy.
- Use ellipsis truncation for canvas/document names rather than wrapping narrow chrome.

### Spacing and density

The interface is compact but not cramped. Use a small, regular spacing rhythm:

- `0.25rem`: tight internal separation, menu shell padding, icon adjustment
- `0.375rem`–`0.5rem`: label gaps and compact control padding
- `0.75rem`: common item padding and action gaps
- `1rem`: section separation
- `1.5rem`: dialog padding and separation before action rows

Typical targets:

- menu item height: roughly `2rem`–`2.25rem`
- compact icon button: `1.875rem`–`2.25rem` square
- normal button/input: at least `2.25rem` high
- sidebar/canvas row: roughly `2.25rem` high

Do not create oversized dashboard spacing, huge headings, or tall rounded controls. Canvas tools should preserve room for the work itself.

### Borders, states, and motion

Every interaction must have an obvious state without changing layout:

- **Hover:** change the flat background to `--accent`/`--background`, or strengthen text color.
- **Selected/active:** use a primary border or underline plus a pale primary/accent fill.
- **Focus:** use `box-shadow: 0 0 0 2px var(--ring)` and remove the default outline only when replacing it.
- **Disabled:** preserve structure, set `cursor: not-allowed`, and reduce opacity to about `0.5`.
- **Danger hover:** use destructive fill with destructive foreground, not merely red text on an ambiguous highlight.
- **Open trigger:** keep it visibly active via `data-expanded`, even when the pointer leaves it.

Motion should be quick and functional: approximately `100ms`–`150ms`, usually `ease` or `ease-out`. Menus may fade and move upward by only `0.25rem`. Avoid spring motion, scaling cards, bouncing, and decorative ambient animation. Respect reduced-motion preferences when adding more substantial animation.

## Menus and context menus

New menus should look like compact command lists attached to a tool, row, or canvas object.

### Menu anatomy

- Render floating menus in a portal so canvas transforms and clipping do not affect them.
- Use `var(--popover)` with a one-pixel border, square corners, and one restrained shadow.
- Give the shell `0.25rem 0` vertical padding. Do not wrap the whole menu in a rounded card.
- Use a practical minimum width (`8.75rem` is a good small-menu baseline), then allow labels to define a wider width.
- Menu items are full-width horizontal rows with `0.5rem 0.75rem` padding, approximately `0.8125rem` text, and no individual border.
- Put an icon first only when icons improve scanning. Keep icon size and column alignment consistent. Do not mix decorated and undecorated items arbitrarily.
- Put keyboard shortcuts or secondary values on the far right in `--muted-foreground`.
- Separate conceptual groups with a thin divider and small vertical padding, not with another card.
- Use a short, muted section label only when grouping is not self-evident.
- Check, radio, submenu, and shortcut indicators should occupy stable columns so labels align.

### Menu behavior

- Highlight the complete row using `data-highlighted`; never rely on hover alone because keyboard navigation matters.
- Keep selected/check state distinct from current keyboard highlight.
- Show disabled commands but mute them and prevent activation.
- Place destructive commands in the final group when possible. Color their text destructive; on highlight, use destructive background and foreground.
- Use an ellipsis in a command label when choosing it opens a follow-up dialog, for example `Rename…`.
- Menus should dismiss on selection, Escape, and outside interaction unless a Kobalte primitive handles a justified exception.
- Avoid modal menus for ordinary anchored actions.

```css
.menuContent {
  min-width: 8.75rem;
  padding: 0.25rem 0;
  border: 1px solid color-mix(in srgb, var(--border) 90%, transparent);
  border-radius: 0;
  background: var(--popover);
  color: var(--popover-foreground);
  box-shadow: 0 10px 24px rgb(0 0 0 / 0.18);
}

.menuItem {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  padding: 0.5rem 0.75rem;
  font-size: 0.8125rem;
  line-height: 1rem;
  outline: none;
}

.menuItem[data-highlighted] {
  background: var(--accent);
  color: var(--accent-foreground);
}
```

## Dialogs and forms

Dialogs are strong white/popover rectangles over a dark neutral overlay. They should read like focused workstation prompts.

- Use an overlay near `rgb(0 0 0 / 0.5)`.
- Center the dialog, use a one-pixel border, square corners, `1.5rem` padding, and restrained shadow.
- Keep common dialogs narrow: approximately `25rem`, capped by `90vw`; use `30rem` only for content that needs it.
- Order content as title, short description, fields, then right-aligned actions.
- Labels sit above fields. Inputs have a one-pixel `--input` border and `--background` fill.
- The focused field gets the amber `--ring`; do not change its dimensions.
- Use a neutral secondary button for cancel. The commit action may be a primary-bordered neutral surface, matching the reference rename dialog.
- Use a fully destructive filled button only for an actual destructive confirmation.
- Keep button labels short, bold, and explicit.

## Canvas extensions and floating tools

Canvas extensions must belong to the workspace while staying visually separate from user content.

### Floating window shell

- Present substantial extensions as compact rectangular workstation windows, not generic dashboard cards.
- Include a thin title bar with the extension name, optional status dots/icon at the left, and overflow/actions at the right.
- Use a pale card or popover surface, one-pixel border, square corners, and a restrained shadow.
- A tab strip sits directly below the title bar. Tabs are flat; the active tab uses stronger text and a thin amber bottom border or pale amber fill.
- Use separators between toolbar, tab, content, and footer regions instead of rounded containers.
- Keep resize/drag affordances subtle. The title bar is the expected drag region; interactive controls inside it must not initiate dragging.
- Ensure extension chrome remains legible over both sparse and busy canvas content.

### Toolbars and inspectors

- Toolbars are narrow vertical or horizontal rails made of repeated square icon buttons.
- Keep icon stroke weight and optical size consistent. Prefer familiar line icons plus tooltips over custom decorative glyphs.
- Active tools use a pale amber/accent background and/or primary edge. Inactive tools remain neutral.
- Show keyboard shortcuts as quiet secondary text, aligned consistently.
- Inspectors use compact labeled sections and full-width controls. Do not turn every property into a separate card.
- Use tabs when switching peer modes (`Chat`, `Actor`, `Tool`, `Preview`, `Settings`), and section headings when content belongs in one continuous workflow.

### Content inside extensions

Extension-specific content may have a stronger personality, but the host chrome must remain Vibecanvas. For example, a generated flashcard can use bold amber and heavy black rules, while its surrounding window, tabs, focus behavior, spacing, and controls follow this guide.

Do not let generated extensions:

- replace theme tokens with a fixed unrelated palette
- use rounded SaaS cards or pill tabs
- obscure the canvas with unnecessarily large panels
- use floating controls without borders or hover/focus states
- imitate macOS, Material, Fluent, or another design system wholesale
- disable canvas pan/zoom shortcuts except while a relevant field is actively editing

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
  border-color: var(--primary);
  background: color-mix(in srgb, var(--primary) 14%, var(--background));
}
```

## AI implementation contract

When this document is supplied to an AI to create a menu, canvas extension, or other UI, it should follow this order:

1. Inspect nearby components and their `*.module.css` before generating code. Reuse established dimensions and interaction patterns when they already solve the problem.
2. Use the existing SolidJS and Kobalte primitives. Do not add a second component library or styling system.
3. Create component-local CSS modules; use semantic theme variables for every theme-dependent color.
4. Start with square, bordered, flat structure. Add a shadow only if the element floats above another surface.
5. Use monospace type, compact spacing, concise labels, and clear typographic hierarchy.
6. Implement hover, keyboard highlight, selected/open, focus-visible, disabled, and destructive states as applicable.
7. Keep canvas extensions compact and preserve canvas interaction. Handle event propagation and keyboard ownership deliberately around editable fields.
8. Verify light, dark, sepia, and graphite themes. Never assume `--background` is white or `--foreground` is black.
9. Verify keyboard navigation, Escape dismissal, focus return, readable contrast, narrow viewport behavior, and reduced motion.
10. Compare the result against the brand test below before considering it complete.

### Brand test

A generated UI is on-brand when the answer to these questions is yes:

- Does it look like a compact tool or workstation window rather than a SaaS card?
- Are corners square and surfaces mostly flat?
- Is amber used sparingly to communicate active/focused state?
- Are borders and typography doing more hierarchy work than shadows and decoration?
- Is all text monospace, compact, and direct?
- Can every command be understood and operated with a keyboard?
- Does the UI leave visual priority and physical space to the canvas?
- Does it inherit all built-in themes without hardcoded light-only colors?

If the design could be dropped unchanged into a generic rounded dashboard, it is not specific enough to Vibecanvas. Simplify it, square it, strengthen its rules and typography, and make its active state amber.
