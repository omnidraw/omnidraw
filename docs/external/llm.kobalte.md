# Kobalte for Solid 2

## Purpose and authority

This is the local implementation reference for using Kobalte with Solid 2.

It is derived from the `solid2` branch of the Kobalte repository, especially:

- `apps/docs/src/routes/docs/core`
- `apps/docs/src/examples`
- `apps/docs/src/routes/docs/changelog/2-0-x.mdx`
- `packages/core/src`
- the workspace and package manifests

The public Kobalte website still documents the Solid 1 release.
Do not use that website to settle Solid 2 API, typing, or setup questions.
Use this guide first, then the GitHub `solid2` branch if an exact prop is missing.

Audited upstream snapshot: `a892187065cf7e0d07e91db02310bd28a5619236`.

## Version contract

The audited branch identifies `@kobalte/core` as `2.0.0-alpha.0`.
Its workspace pins this coherent runtime family:

```text
solid-js       2.0.0-rc.0
@solidjs/web   2.0.0-rc.0
```

The branch changelog describes the intended stable Kobalte 2 contract as:

```text
solid-js       ^2.0.0
@solidjs/web   ^2.0.0
```

Therefore:

- For the audited alpha/RC branch, keep `solid-js` and `@solidjs/web` on the exact same RC.
- Do not combine RC.0 with RC.1 or a stable release.
- When a stable Kobalte 2 package is installed, trust its actual peer dependencies.
- Kobalte 2 does not support Solid 1.
- Do not copy dependency advice from the current public website.

Kobalte is headless and unstyled.
It supplies ARIA semantics, focus management, keyboard interaction, hidden form controls,
overlay dismissal, and state attributes.
The application supplies layout, color, typography, motion, and product policy.

## Installation and compiler setup

Install the Solid 2-compatible Kobalte package with both Solid peers.
Use the repository's package manager and exact dependency policy.

The TypeScript JSX import source must be `@solidjs/web`:

```json
{
	"compilerOptions": {
		"jsx": "preserve",
		"jsxImportSource": "@solidjs/web"
	}
}
```

The important Solid 2 import split is:

```tsx
import { createSignal, For, Show, type Accessor } from "solid-js";
import { Portal, type ComponentProps, type JSX, type ValidComponent } from "@solidjs/web";
```

Use `solid-js` for reactivity, control flow, context, and lifecycle.
Use `@solidjs/web` for DOM rendering APIs and DOM/JSX types.

Do not use these Solid 1 forms:

```tsx
// Wrong for this guide.
import type { JSX } from "solid-js";
import { Portal } from "solid-js/web";
```

In Solid 2 JSX, use lowercase `tabindex`, not `tabIndex`:

```tsx
<div tabindex={-1} />
```

If authoring context directly, Solid 2 providers are rendered as the context itself:

```tsx
const LocaleContext = createContext("en");

<LocaleContext value="fr">
	<App />
</LocaleContext>;
```

Do not write `<LocaleContext.Provider>` in new Solid 2 code.
Kobalte's public components such as `I18nProvider` remain normal components.

## Imports and root components

Prefer package subpath imports:

```tsx
import { Dialog } from "@kobalte/core/dialog";
import { Select } from "@kobalte/core/select";
import { TextField } from "@kobalte/core/text-field";
```

The root barrel is deprecated:

```tsx
// Deprecated and emits a warning.
import { Dialog } from "@kobalte/core";
```

In Kobalte 2, the namespace-like component is itself the root component:

```tsx
<Dialog open={open()} onOpenChange={setOpen}>
	<Dialog.Trigger>Open</Dialog.Trigger>
	<Dialog.Portal>
		<Dialog.Overlay />
		<Dialog.Content>
			<Dialog.Title>Settings</Dialog.Title>
		</Dialog.Content>
	</Dialog.Portal>
</Dialog>
```

`<Dialog.Root>` is retained only as a deprecated alias.
The same rule applies to components such as `Select`, `Checkbox`, `Tabs`, and `Popover`.

Individual parts may be imported directly when desired:

```tsx
import { Root, Trigger, Portal, Content } from "@kobalte/core/popover";
```

Prefer the callable namespace form in application code because it keeps anatomy visible.

## Core composition model

Most Kobalte widgets are compound components.
The root owns state and context; named parts supply semantics and behavior.
Preserve the documented nesting.

Typical shape:

```tsx
<Widget value={value()} onChange={setValue}>
	<Widget.Label>Label</Widget.Label>
	<Widget.Control />
	<Widget.Description>Help text</Widget.Description>
	<Widget.ErrorMessage>Validation message</Widget.ErrorMessage>
</Widget>
```

Do not replace required Kobalte parts with arbitrary `div` elements.
Examples:

- A `Dialog.Content` owns dialog focus and dismissal behavior.
- A `Select.Listbox` owns listbox navigation.
- A `Checkbox.Input` is the native form control.
- A `RadioGroup.ItemInput` is the native radio input.
- An `Accordion.Trigger` belongs inside an `Accordion.Header`.

Kobalte frequently renders no element for the root.
Place DOM props on the documented rendered part, not blindly on the root.

## Controlled and uncontrolled state

Kobalte follows a consistent state convention.

Uncontrolled state uses `default*`:

```tsx
<Dialog defaultOpen />
<Checkbox defaultChecked />
<Tabs defaultValue="details" />
```

Controlled state uses a value and change callback:

```tsx
const [open, setOpen] = createSignal(false);

<Dialog open={open()} onOpenChange={setOpen} />;
```

Common pairs:

| State | Controlled | Uncontrolled | Callback |
|---|---|---|---|
| Overlay visibility | `open` | `defaultOpen` | `onOpenChange` |
| Boolean choice | `checked` | `defaultChecked` | `onChange` |
| Toggle button | `pressed` | `defaultPressed` | `onChange` |
| Selection | `value` | `defaultValue` | `onChange` |
| Pagination | `page` | `defaultPage` | `onPageChange` |
| Resizable panels | `sizes` | `initialSizes` | `onSizesChange` |

Do not pass both a controlled and uncontrolled prop for the same state.
Controlled callbacks receive the proposed new state; update the signal yourself.

When asynchronous work controls a component, fence stale completions by identity or generation.
Kobalte manages UI state, not application request lifetime.

## Solid 2 reactive discipline around Kobalte

Treat Kobalte props as reactive getters.
Read them in tracked compute scopes, event handlers, or explicit snapshots.

Solid 2 effects use compute/apply separation:

```tsx
createEffect(
	() => ({ open: props.open, itemId: props.itemId }),
	(snapshot) => {
		// Apply side effects from the snapshot.
	},
);
```

Do not start DOM work, subscriptions, network work, or signal writes in the compute phase.
Do not re-read reactive props in an untracked apply callback.

For an event or async launch, capture the relevant identity first:

```tsx
const save = async () => {
	const itemId = props.itemId;
	const generation = requestGeneration;
	await updateItem(itemId);
	if (generation !== requestGeneration || itemId !== props.itemId) return;
	setOpen(false);
};
```

Kobalte callbacks may fire during focus restoration, dismissal, or form reset.
Keep callback writes scoped to live component state and invalidate pending work on cleanup.

## Children and render props

Some parts expose state through function children.
Call accessors where the branch examples do.

```tsx
<Select.Value<string>>
	{state => state.selectedOption()}
</Select.Value>
```

Multiple combobox controls expose selected values and mutation methods:

```tsx
<Combobox.Control<string>>
	{state => (
		<>
			<For each={state.selectedOptions()}>{option => <span>{option}</span>}</For>
			<Combobox.Input />
			<button type="button" onClick={state.clear}>Clear</button>
		</>
	)}
</Combobox.Control>
```

Do not assume every callback child is tracked like normal JSX.
Avoid outer branching on reactive values inside callbacks documented as untracked.
Move reactive selection into normal JSX, a memo, or the exact callback contract.

## Polymorphism with `as`

DOM-rendering parts accept `as` to change the rendered element or component:

```tsx
<Tabs.Trigger value="docs" as="a" href="/docs">Docs</Tabs.Trigger>
<Tabs.Trigger value="settings" as={DesignSystemButton}>Settings</Tabs.Trigger>
```

Callback form gives precise forwarding control:

```tsx
<Tabs.Trigger
	value="docs"
	as={props => <DesignSystemButton tone="quiet" {...props} />}
>
	Docs
</Tabs.Trigger>
```

Rules for `as` callbacks:

- Always spread the provided props.
- Kobalte options consumed internally are not passed to the callback.
- Custom DOM/component props are forwarded unchanged.
- Put event handlers on the Kobalte parent, not inside the callback.
- Do not overwrite Kobalte-controlled render props or ARIA attributes.
- A custom component must forward its ref and DOM props to the interactive element.

User event handlers run before Kobalte's internal handlers.
Use documented cancelable callbacks when preventing default behavior.

For wrapper libraries, use exported Solid 2 types:

```tsx
import type { TabsTriggerOptions, TabsTriggerRenderProps } from "@kobalte/core/tabs";
import type {
	ElementOf,
	PolymorphicCallbackProps,
	PolymorphicProps,
} from "@kobalte/core/polymorphic";
import type { ValidComponent } from "@solidjs/web";
```

Each polymorphic part generally exposes:

- `ComponentOptions`: Kobalte-only options, not forwarded.
- `ComponentCommonProps<T>`: customizable DOM props such as `id`, `ref`, and events.
- `ComponentRenderProps`: Kobalte-owned DOM and ARIA props; do not modify.
- `ComponentProps<T>`: public component props.

Use `OverrideComponentProps` from `@kobalte/utils` for a fixed-element wrapper.

## Styling and state

Every rendered part accepts `class` and supported DOM attributes:

```tsx
<Popover.Trigger class="popover-trigger">Open</Popover.Trigger>
<Popover.Content class="popover-content">...</Popover.Content>
```

Kobalte state is exposed through presence-only data attributes:

```text
data-expanded       data-closed
data-disabled       data-readonly
data-required       data-valid       data-invalid
data-checked        data-indeterminate
data-selected       data-pressed
data-highlighted    data-current
data-orientation    data-swipe
```

Style attribute presence rather than assigning application-owned ARIA state:

```css
.menu-item[data-highlighted] { background: var(--surface-hover); }
.checkbox-control[data-checked] { border-color: var(--accent); }
```

Do not remove focus outlines without a visible `:focus-visible` replacement.
Do not use color alone for selection, validation, or disabled state.

Tailwind 3 may use `@kobalte/tailwindcss` modifiers such as `ui-expanded:*`.
Tailwind 4 supports data-attribute variants directly; the plugin is unnecessary.

## Portals, ownership, and themes

Overlay families expose a `.Portal` part which normally targets `document.body`:

```tsx
<Popover.Portal>
	<Popover.Content>...</Popover.Content>
</Popover.Portal>
```

Portaling avoids clipping by local overflow and stacking contexts.
It also means descendant CSS selectors and inherited theme variables may no longer apply.

For themed applications:

- Put theme variables on a shared document root when possible.
- Otherwise pass the supported portal mount target from the exact component API.
- Keep trigger and content in the same owner document.
- Do not use ambient global `document` for secondary-window components.
- Test focus restoration in the actual owner document.

Do not omit `.Portal` merely to simplify tests.
Inline content changes clipping, stacking, ownership, and dismissal behavior.

Toast regions are usually wrapped in `Portal` imported from `@solidjs/web`.

## Floating placement

Popover, Tooltip, HoverCard, Select, Combobox, Search, and menu families use Kobalte's popper layer.
Common root placement props include:

```text
placement          gutter             shift
flip               slide              overlap
sameWidth          fitViewport        hideWhenDetached
detachedPadding    arrowPadding       overflowPadding
getAnchorRect
```

Use built-in collision behavior instead of fixed viewport coordinates.
Useful CSS variables include:

```text
--kb-popper-anchor-width
--kb-popper-available-width
--kb-popper-available-height
--kb-popper-overflow-padding
--kb-*-content-transform-origin
```

Set `sameWidth` for trigger-width listboxes.
Set `fitViewport` for bounded content and add overflow scrolling in CSS.
Keep `flip` and `slide` enabled near viewport edges.
The popper positioner copies the content's `z-index`; assign stacking there.

## Overlay focus and dismissal

Dialog and AlertDialog are modal by default.
Modal mode traps focus, locks outside interaction, hides outside content from screen readers,
normally locks scrolling, and restores focus to the trigger on close.

`modal={false}` leaves background interaction available.
`preventScroll` can request scroll locking independently.

Content parts commonly expose cancelable lifecycle callbacks:

```text
onOpenAutoFocus
onCloseAutoFocus
onEscapeKeyDown
onPointerDownOutside
onFocusOutside
onInteractOutside
```

Call `event.preventDefault()` only when deliberately replacing default behavior.
If autofocus or restoration is canceled, focus an appropriate destination yourself.

Always render `Title` for Dialog, AlertDialog, Drawer, and dialog-like Popover content.
Render `Description` when it provides useful context.
For destructive AlertDialog actions, initially focus the least destructive action.

`forceMount` keeps normally conditional portal/content parts mounted.
Use it only when an external animation system owns presence.

## Animation

Kobalte supports CSS enter and exit animations.
Presence-aware parts delay unmount while CSS exit animation runs.

```css
.popover-content { animation: hide 180ms ease-in forwards; }
.popover-content[data-expanded] { animation: show 180ms ease-out; }
```

Common size and motion variables:

```text
--kb-accordion-content-width / -height
--kb-collapsible-content-width / -height
--kb-tabs-indicator-width / -height
--kb-toast-progress-fill-width
--kb-toast-swipe-move-x / -y
--kb-toast-swipe-end-x / -y
```

Respect `prefers-reduced-motion`.
Do not use timers to guess when Kobalte unmounted content.

## Forms and validation

Form-aware controls use real or hidden native inputs.
This provides form submission, autofill where supported, and reset integration.

Common root props:

```text
name
value / defaultValue
checked / defaultChecked
required
disabled
readOnly
validationState="valid" | "invalid"
```

Common semantic parts are `Label`, `Description`, `ErrorMessage`, and `Input` or `HiddenInput`.
`ErrorMessage` normally renders only for `validationState="invalid"`.
Use its `forceMount` prop only for owned animation or persistent layout.

Do not remove hidden inputs because the visual control works without them.
Most field roots accept `name`; `FileField.HiddenInput` receives its form name.
Each radio item contributes its `value` under the group's `name`.

Keep labels visible unless the design supplies an equally clear accessible name.
Otherwise use `aria-label` or `aria-labelledby` on the documented control.

## Select, Combobox, and Search data

Select and Combobox require an `options` collection and an `itemComponent`.

```tsx
const fruits = ["Apple", "Banana", "Pear"];

<Select
	options={fruits}
	itemComponent={props => (
		<Select.Item item={props.item}>
			<Select.ItemLabel>{props.item.rawValue}</Select.ItemLabel>
			<Select.ItemIndicator>✓</Select.ItemIndicator>
		</Select.Item>
	)}
>
	<Select.Trigger aria-label="Fruit">
		<Select.Value<string>>{state => state.selectedOption()}</Select.Value>
		<Select.Icon>⌄</Select.Icon>
	</Select.Trigger>
	<Select.Portal>
		<Select.Content><Select.Listbox /></Select.Content>
	</Select.Portal>
</Select>
```

For object options, use a root generic and map `optionValue`, `optionTextValue`, and
`optionDisabled`; render labels from `props.item.rawValue`.
For grouped options, also provide `optionGroupChildren`, `sectionComponent`, and a group generic.
With `multiple`, value props and `onChange` use arrays.

Combobox filtering uses `onInputChange` and the configured filter mode.
Search is the external-filtering variant: the application owns result fetching/filtering.

## Component catalog

### Actions, status, and choice controls

- `Button` is a native button by default, supports `as`, and handles Space/Enter.
  Set `type="button"` for non-submit actions inside forms.
- `ToggleButton` uses `pressed`, `defaultPressed`, and `onChange`.
- `ToggleGroup` composes `Item` children, supports orientation, and uses arrays with `multiple`.
- `Alert` is a live region for important, time-sensitive content.
- `Badge` has status semantics; supply `textValue` for non-text visual content.
- `Skeleton` is a visual placeholder, not the loading semantics for its surrounding region.
- `Image` composes `Img` and `Fallback`; provide native `alt` text.
- `Checkbox` composes `Input`, `Control`, `Indicator`, `Label`, and message parts.
  It supports checked, unchecked, and indeterminate visual state.
- `Switch` composes `Input`, `Control`, `Thumb`, and labels.
  Use it for an immediate on/off setting, not a confirmation action.
- `RadioGroup` item anatomy is `Item`, `ItemInput`, `ItemControl`, `ItemIndicator`,
  `ItemLabel`, and `ItemDescription`. Layout wrappers should use `role="presentation"`
  to avoid Chromium semantics bugs.
- `SegmentedControl` uses radio-group semantics with an animatable group `Indicator`.
- `Rating` uses `Control`, `HiddenInput`, `Item`, and `ItemControl`, and supports half steps.

### Fields

- `TextField` composes `Label`, `Input` or `TextArea`, `Description`, and `ErrorMessage`.
- `NumberField` adds `HiddenInput`, increment/decrement triggers, formatting, min/max, and step.
  `onChange` receives displayed text; `onRawValueChange` receives the number.
- `TimeField` uses internationalized values and `Segment` children.
  Include `HiddenInput`; configure granularity, hour cycle, time zone, min/max, and placeholder.
- `FileField` includes Dropzone, Trigger, HiddenInput, ItemList, preview, size, and delete parts.
  It supports MIME/count/size limits, validation, multiple files, and drag/drop.
  Put the form name on `FileField.HiddenInput` and revoke application object URLs.
- `OTPField` uses one hidden native Input for keyboard, autofill, and selection.
  Build visual slots with `useOTPFieldContext`; do not create one input per digit.
- `ColorField` parses/formats hex values; `ColorChannelField` is a localized spinbutton.
  Use values such as `parseColor` from `@kobalte/core/colors`.

### Collections, disclosure, and navigation

- `Select` is a button/listbox with single/multiple values, groups, disabled items, typeahead,
  form/autofill support, and required Trigger/Value/Listbox/item-renderer anatomy.
- `Combobox` adds Input and configurable filtering inside `Control`.
  Use `optionLabel` plus value/text mappings for objects; preserve virtual focus.
- `Search` leaves fetching/filtering to the application and supports debounce, Indicator,
  loading UI, and NoResult.
- `Pagination` composes Items, Item, Ellipsis, Previous, and Next.
  Control it with `page` and `onPageChange`, and name its navigation landmark.
- `Collapsible` composes Trigger and Content and uses `open`/`defaultOpen`.
- `Accordion` composes Item, Header, Trigger, and Content; values are always `string[]`.
  `multiple` allows several open items, `collapsible` allows the last to close, and Header's
  `as` must use the correct page heading level.
- `Tabs` composes List, Trigger, optional Indicator, and matching Content.
  It supports orientation and automatic/manual activation; empty panels become focusable.
- `Breadcrumbs` is a landmark using native `ol`/`li`, Link, and screen-reader-hidden Separator.
- `Link` is an anchor by default; use a real `href` for navigation.
- `NavigationMenu` is for site navigation, not generic commands; preserve link semantics.

### Menus

- `DropdownMenu` is a menu button for commands with Trigger, Portal, Content, and items.
- `ContextMenu` uses the same item system but opens by context gesture or touch long-press.
  Never make an essential action available only through it.
- `Menubar` owns top-level `Menu` entries with Trigger and Content for desktop-style interaction.
- Use `Item` for actions, `CheckboxItem` for independent toggles, and `RadioItem` inside
  `RadioGroup` for one-of-many choices.
- Use `Group`/`GroupLabel` for labelled sets and `Sub`/`SubTrigger`/portaled `SubContent`
  for nested commands. Do not put ordinary focusable controls inside a menu item.

### Overlays

- `Dialog` is a modal or non-modal window composed from Trigger, Portal, Overlay, Content,
  Title, Description, and CloseButton. Application code owns async/pending policy.
- `AlertDialog` is for consequential confirmation and should initially focus the least
  destructive action.
- `Popover` is dialog-like interactive content anchored to Trigger or optional Anchor.
  Compose Portal, Content, optional Arrow, Title, Description, and CloseButton.
- `Tooltip` is non-interactive descriptive text opened by focus or hover.
  It supports delays, focus-only mode, and Escape; never put interactive content inside.
- `HoverCard` is a rich preview. Essential information/actions must remain available without hover.
- `Drawer` is dialog-based and opens from any edge with drag dismissal, fraction/pixel snap points,
  and live overlay opacity. `data-no-drag` opts descendants out; `Drawer.useContext()` sets snaps.
  Position Content in CSS against the same edge as `side`.

### Layout, progress, and color

- `Resizable` alternates Panel and labelled Handle, supports both orientations, fraction/pixel
  sizes, min/max, collapse, controlled sizes, and context/render-prop resize methods.
  Arrows resize, Shift+Arrow jumps, and Enter toggles adjacent collapsible panels.
- `Slider` supports one/multiple thumbs with hidden Input per thumb and composes Label,
  ValueLabel, Track, Fill, Thumb/Input, and optional messages.
- `Progress` is task completion; `Meter` is a scalar measurement in a known range.
  Both compose Label, ValueLabel, Track, and Fill.
- `Separator` is native `hr`; set orientation when rendering another element.
- `ColorArea` selects two channels with two hidden inputs; `ColorSlider` controls one channel;
  `ColorWheel` controls hue; `ColorSwatch` is an accessible preview.
  Keep localized labels and hidden inputs rather than rebuilding keyboard math.

## Toasts

Create toasts through `toaster` and render regions once near the app root:

```tsx
import { Toast, toaster } from "@kobalte/core/toast";
import { Portal } from "@solidjs/web";

const showSaved = () => toaster.show(props => (
	<Toast toastId={props.toastId}>
		<Toast.Title>Saved</Toast.Title>
		<Toast.Description>Your changes are stored.</Toast.Description>
		<Toast.CloseButton aria-label="Dismiss">×</Toast.CloseButton>
	</Toast>
));

<Portal>
	<Toast.Region limit={3} pauseOnInteraction pauseOnPageIdle>
		<Toast.List />
	</Toast.Region>
</Portal>;
```

Every Toast must receive the callback's `toastId`.
Operations are `show`, `update`, `dismiss`, `clear`, and `promise`.
Use show option `region` with matching Region `regionId` for multiple regions.
Hotkeys, focus/hover/page-idle pause, queue limits, swipe, and progress are built in.
Do not announce the same event through both Alert and Toast.

## Internationalization and SSR

Kobalte uses browser locale by default.
Override it with the subpath provider:

```tsx
import { I18nProvider, useLocale } from "@kobalte/core/i18n";

<I18nProvider locale="fr-FR"><App /></I18nProvider>;
```

Expose locale and direction at an application DOM root:

```tsx
function App() {
	const { locale, direction } = useLocale();
	return <main lang={locale()} dir={direction()}>...</main>;
}
```

Locale affects number/time formatting, filtering, announcements, and RTL navigation.
Do not hard-code arrow direction assumptions.

Kobalte expects correctly configured Solid SSR.
SolidStart and any compiler must support the same Solid 2 family.
Keep application browser-only code behind client/mount boundaries.
Do not import DOM APIs from legacy `solid-js/web`.

If a framework externalizes Solid packages during SSR, verify that its Solid package conditions
resolve the `solid` export correctly for `@kobalte/core`.
Do not fall back to Solid 1 output to work around framework configuration.

## Accessibility behavior to preserve

Kobalte follows WAI-ARIA patterns, but composition can still break them.

Always preserve:

- documented root/part nesting;
- generated IDs and ARIA relationships;
- Kobalte refs and forwarded props;
- native hidden inputs;
- roving or virtual focus managed by collections;
- Portal ownership and focus restoration;
- keyboard opening, navigation, selection, Escape, Home, and End;
- modal containment and outside inertness;
- visible focus indication;
- accessible names for icon-only triggers and handles.

Do not add redundant roles to Kobalte parts.
Do not overwrite `aria-expanded`, `aria-controls`, `aria-selected`, `aria-checked`, or `tabindex`.
Do not put one semantic composite inside another unless documented.

Keyboard checks by family:

| Family | Minimum checks |
|---|---|
| Button/toggle | Tab, Space, Enter |
| Dialog/drawer | initial focus, Tab loops, Escape, return focus |
| Menu | trigger arrows, item arrows, Home/End, typeahead, Escape |
| Select/combobox | open arrows, traversal, selection, Escape, typing |
| Tabs | orientation arrows, Home/End, automatic/manual activation |
| Radio/toggle group | orientation arrows, disabled skip, selection |
| Slider/resizable | arrows, modifiers, edge behavior |
| Tooltip | focus/hover open, Escape close, no interactive content |

## Testing guidance

Test through roles, names, state, and focus rather than implementation classes.

For every changed Kobalte surface, cover:

1. Closed or initial mount.
2. Pointer opening.
3. Keyboard opening.
4. Arrow/Home/End traversal where applicable.
5. Selection or submit behavior.
6. Escape and outside dismissal.
7. Focus restoration.
8. Disabled/read-only behavior.
9. Controlled updates from outside.
10. Unmount while open or while application work is pending.

For portaled content, query the owner document rather than the local container only.
For modal content, test programmatic focus escape as well as Tab loops.
For floating content, test viewport edges and overflow containers.
For forms, test `FormData` and native reset.
For Solid 2, capture development warnings and fail on strict-read or owned-scope diagnostics.

Do not silence missing browser APIs globally without proving the polyfill contract.
Do not replace a Kobalte primitive merely because a DOM-only unit test is inconvenient.

## Agent implementation checklist

Before writing code:

- Confirm installed `@kobalte/core` is the Solid 2 line.
- Confirm `solid-js` and `@solidjs/web` are one exact prerelease or compatible stable family.
- Confirm `jsxImportSource` is `@solidjs/web`.
- Read this component section; inspect the `solid2` branch only for omitted exact props.
- Choose Button, Menu, Listbox, Dialog, Popover, or Tooltip semantics deliberately.

While writing code:

- Import from `@kobalte/core/<component>`.
- Use `<Component>`, not deprecated `<Component.Root>`.
- Keep Kobalte anatomy intact.
- Spread polymorphic props and forward refs.
- Use lowercase `tabindex` for authored DOM attributes.
- Use `@solidjs/web` for JSX and DOM types.
- Snapshot reactive identities before async work.
- Use Kobalte Portal and popper placement for overlays.
- Add labels, descriptions, and errors through semantic parts.
- Style `data-*` state without overriding ARIA.

Before finishing:

- Exercise pointer and keyboard paths.
- Check focus entry, containment, dismissal, and restoration.
- Check secondary owner documents if supported.
- Check viewport collision and overflow clipping.
- Check HTML form submission/reset.
- Check reduced motion and exit animation.
- Run with Solid development diagnostics enabled.
- Verify no `solid-js/web` import or DOM `JSX` type from `solid-js` remains.

## When this guide is insufficient

Inspect the GitHub `solid2` branch in this order:

1. `apps/docs/src/routes/docs/core/(1)components/<component>.mdx`
2. `apps/docs/src/examples/<component>.tsx`
3. `packages/core/src/<component>/index.tsx`
4. The exact part implementation and tests under `packages/core/src/<component>`
5. `apps/docs/src/routes/docs/changelog/2-0-x.mdx`

Prefer branch source and tests over the deployed website.
If branch prose conflicts with its manifest or implementation, record the audited commit,
follow the installed package contract, and verify behavior with a focused test.
