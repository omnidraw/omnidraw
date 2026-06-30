## Why Arrow

Arrow is a reactive UI framework built around JavaScript primitives:
 Modules, functions, and template literals. Arrow is just TypeScript, so your coding agent already knows how to use it really well.

You only need 3 functions:

- `reactive`
- `html`
- `component`

Unlike other major frameworks, there is no "idomatic" way to use Arrow since it's just TypeScript functions and template literals. The entire documentation fits in less than 5% of a 200k context window.

Arrow requires no build step, no JSX compilation, no React compiler, no Vite plugin (there is one if you need SSR), no Vue template complier, and yet it runs incredibly fast at less than 5kb over the wire. When coupled with the [Arrow sandbox](#sandbox), it's perfect for interfaces produced by chat agents too.

## Quickstart

Scaffold a complete Vite 8 Arrow app with SSR, hydration, route-based
 metadata, and the full framework stack in one command:

$
 pnpm create arrow-js@latest arrow-app

Coding agent skill
 
 
 Install the Arrow coding agent skill wrapper if you want the same
 project-specific guidance in tools like Codex and Claude Code.

$
 npx @arrow-js/skill@latest

Other ways to install
 
 
 Arrow still works fine without a build tool. If you only need the core
 runtime, a simple module import is enough.

#### From npm:

```shell
npm install @arrow-js/core
```

#### From a CDN:

```html
<script type="module">
  import { reactive, html } from 'https://esm.sh/@arrow-js/core'
</script>
```

### Editor support

Install the official
 [ArrowJS Syntax](https://marketplace.visualstudio.com/items?itemName=StandardAgents.arrowjs-syntax)
 extension for VSCode to get syntax highlighting and
 autocomplete inside `html` template literals.
 Arrow also ships TypeScript definitions for full editor support.

## Community

Join the
 [Arrow Discord](https://discord.gg/fBy7csvmAt)
 to ask questions, share what you're building, and connect with
 other developers using Arrow.

Follow the author
 [Justin Schroeder](https://x.com/intent/follow?screen_name=jpschroeder)
 on X for updates, releases, and behind-the-scenes development.

Browse the source, report issues, and contribute on
 [GitHub](https://github.com/standardagents/arrow-js).

## Reactive Data

`reactive()` turns plain objects, arrays, or expressions
 into live state that Arrow (or anyone else) can track and update from.

`reactive(value)` or `reactive(() => value)`

- Wrap objects or arrays to create observable state.
- Pass an expression to create a computed value.
- Use it for local component state, shared stores, and mutable props.
- Read properties normally. Arrow tracks those reads inside watchers
 and template expressions.
- Use `$on` and `$off` when you want manual
 subscriptions.

```ts
import { reactive } from '@arrow-js/core'

const data = reactive({
  price: 25,
  quantity: 10
})

console.log(data.price) // 25
```

### Computed values

`reactive(() => value)` reruns when its tracked reads
 change.

```ts
import { reactive } from '@arrow-js/core'

const props = reactive({ count: 2, multiplier: 10 })

const data = reactive({
  total: reactive(() => props.count * props.multiplier)
})

console.log(data.total) // 20
props.count = 3
console.log(data.total) // 30
```

> **Tip**
> `data.total` reads like a normal value even though it is
 backed by a tracked expression.

## Templates

To render DOM elements with Arrow you use the
 `html` tagged template literal.

`html`...`` â€” create a mountable template

- Templates can be mounted directly, passed around, or returned from
 components.
- Expression slots are static by default, but if callable functions
 are provided they will update when their respective reactive data is
 changed. In other words `${data.foo}` is static but
 `${() => data.foo}` is reactive.
- Templates can render text, attributes, properties, lists, nested
 templates, and events.

Plain values render once. If you pass a function like
 `() => data.count`, Arrow tracks the reactive reads inside
 that function and updates only that part of the template when they
 change.

### Attributes

Use a function expression to keep an attribute in sync.

```ts
import { html, reactive } from '@arrow-js/core'

const data = reactive({ disabled: false })

html`<button disabled="${() => data.disabled}">
  Save
</button>`
```

> **Tip**
> Returning `false` from an attribute expression will
 remove the attribute. This makes it easy to toggle attributes.

```ts
import { html, reactive } from '@arrow-js/core'

const data = reactive({ disabled: false })

html`<button disabled="${() => data.disabled ? true : false}">
  Save
</button>`
```

### Lists

Return an array of templates to render a list. Add
 `.key(...)` when identity must survive reorders.

```ts
import { html, reactive } from '@arrow-js/core'

const data = reactive({
  todos: [
    { id: 1, text: 'Write docs' },
    { id: 2, text: 'Ship app' },
  ],
})

html`<ul>
  ${() => data.todos.map((todo) =>
    html`<li>${todo.text}</li>`.key(todo.id)
  )}
</ul>`
```

> **Tip**
> Keys are only necessary if you want to preserve the DOM nodes and
 their state. Avoid using the index as a key.

```ts
import { html, reactive } from '@arrow-js/core'

const data = reactive({ tags: ['alpha', 'beta', 'gamma'] })

html`<ul>
  ${() => data.tags.map((tag) => html`<li>${tag}</li>`)}
</ul>`
```

### Events

`@eventName` attaches an event listener.

```ts
import { html } from '@arrow-js/core'

html`<button @click="${(e) => console.log(e)}">Click</button>`
```

## Components

Arrow components are plain functions wrapped with
 `component()`. A component mounts once per render slot and
 keeps local state while that slot survives parent rerenders.

- Pass a reactive object as props.
- Read props lazily inside expressions like
 `() => props.count`.
- Keep local component state with `reactive()` inside the
 component.
- Use `.key(...)` when rendering components in keyed lists.

```ts
import { component, html, onCleanup, reactive } from '@arrow-js/core'
import type { Props } from '@arrow-js/core'

const parentState = reactive({ count: 1 })

const Counter = component((props: Props<{ count: number }>) => {
  const local = reactive({ clicks: 0 })
  const onResize = () => console.log(window.innerWidth)

  window.addEventListener('resize', onResize)
  onCleanup(() => window.removeEventListener('resize', onResize))

  return html`<button @click="${() => local.clicks++}">
    Root count ${() => props.count} | Local clicks ${() => local.clicks}
  </button>`
})

html`<section>
  <h3>Dashboard</h3>
  ${Counter(parentState)}
</section>`
```

> **Key concept**
> The component function itself is not rerun on every parent update.
 Arrow keeps the instance for that slot and retargets its props when
 needed. That makes local state stable across higher-order rerenders.

In the common case, just pass a reactive object directly as the
 component props.

```ts
import { component, html, reactive } from '@arrow-js/core'

const state = reactive({ count: 1, theme: 'dark' })
const Counter = component((props) =>
  html`<strong>${() => props.count}</strong>`
)

html`<p>
  Current count:
  ${Counter(state)}
</p>`
```

> **Tip**
> Props stay live when you read them lazily. Avoid destructuring them
 once at component creation time if you expect updates.

Use `onCleanup()` inside a component when you set up
 manual listeners, timers, or sockets that need teardown when the
 component slot unmounts.

### Async components

The same core `component()` also accepts async factories
 when the Arrow async runtime is present:

```ts
import { component, html } from '@arrow-js/core'
import type { Props } from '@arrow-js/core'

type User = { id: string; name: string }

const UserName = component(
  async ({ id }: Props<{ id: string }>) => {
    const user = await fetch(`/api/users/${id}`)
      .then((r) => r.json() as Promise<User>)
    return user.name
  },
  { fallback: html`<span>Loading userâ€¦</span>` }
)

const UserCard = component((props: Props<{ id: string }>) =>
  html`<article>${UserName(props)}</article>`
)
```

The async body resolves data, and the surrounding template stays
 reactive in the usual Arrow way. SSR waits for async components to
 settle, and hydration resumes JSON-safe results from serialized
 payload data automatically.

> **Tip**
> Most async components need no extra options. Arrow assigns ids,
 snapshots JSON-safe results, and renders resolved values directly by
 default. Reach for `fallback`, `render`,
 `serialize`, `deserialize`, or
 `idPrefix` only when the default behavior is not enough.

## Watching Data

`watch(effect)` or
 `watch(getter, afterEffect)`

- Use it for derived side effects outside templates.
- Dependencies are discovered automatically from reactive reads.
- Arrow also drops dependencies that are no longer touched on later
 runs.
- Watchers created inside a component are stopped automatically when
 that component unmounts.

Single-effect form:

```ts
import { reactive, watch } from '@arrow-js/core'

const data = reactive({ price: 25, quantity: 10, logTotal: true })

watch(() => {
  if (data.logTotal) {
    console.log(`Total: ${data.price * data.quantity}`)
  }
})
```

Getter plus effect form:

```ts
import { reactive, watch } from '@arrow-js/core'

const data = reactive({ price: 25, quantity: 10, logTotal: true })

watch(
  () => data.logTotal ? data.price * data.quantity : null,
  (total) => total !== null && console.log(`Total: ${total}`)
)
```

## Sandbox

`@arrow-js/sandbox` lets you run JS/TS/Arrow inside
 a WASM virtual machine while the host page keeps ownership of the real DOM rendered by `html()`. These two environments only communicate through serialized messages, which allows safe execution of AI-generated code and makes the sandbox a good fit for inline UI produced by chat agents.

- `source` must include exactly one
 `main.ts` or `main.js` entry file.
- `main.css` is optional and is injected into the sandbox
 host root.
- The sandbox renders through a stable `<arrow-sandbox>`
 custom element.
- Call `output(payload)` inside sandboxed code to send data
 back through the optional `events.output` handler.

```ts
import { html } from '@arrow-js/core'
import { sandbox } from '@arrow-js/sandbox'

const root = document.getElementById('app')
if (!root) throw new Error('Missing #app root')

const source = {
  'main.ts': [
    "import { html, reactive } from '@arrow-js/core'",
    '',
    'const state = reactive({ count: 0 })',
    '',
    'export default html`<button @click="${() => state.count++}">',
    '  Count ${() => state.count}',
    '</button>`',
  ].join('\n'),
  'main.css': [
    'button {',
    '  font: inherit;',
    '  padding: 0.75rem 1rem;',
    '}',
  ].join('\n'),
}

html`<section>${sandbox({ source })}</section>`(root)
```

### Prompt for agents

If you want an agent to generate a sandbox payload directly, this
 prompt keeps the output narrow and aligned with Arrow.

Agent Prompt
 Copy

`Build this UI as an Arrow sandbox payload. Return an object for sandbox({ source, ... }) with exactly one entry file named main.ts or main.js, plus main.css only if styles are needed. Use @arrow-js/core primitives directly: reactive(...) for state, html`...` for DOM, and component(...) only when reusable local state or composition is actually needed. Arrow expression slots are static by default, so any live value must be wrapped in a callable function like ${() => state.count}. Use event bindings like @click="${() => state.count++}", do not use JSX, React hooks, Vue directives, direct DOM mutation, or framework-specific render APIs.

Export a default Arrow template or component result from main.ts. Keep the example self-contained, prefer a single clear root view, and communicate back to the host with output(payload) when needed. Put CSS in main.css, keep payloads JSON-serializable, and only return the files that are necessary for the requested interface. If you create multiple files, make sure imports match the virtual filenames you place in source.`
 

 
 JSON schema tool
 
 
 If your agent supports tool calling, this schema produces the exact
 argument object expected by `sandbox()`.

create_arrow_sandbox
 Copy

`{
 "name": "create_arrow_sandbox",
 "description": "Produce arguments for @arrow-js/sandbox.",
 "inputSchema": {
 "type": "object",
 "additionalProperties": false,
 "properties": {
 "source": {
 "type": "object",
 "description": "Virtual files passed to sandbox({ source }). Must include main.ts or main.js. main.css is optional.",
 "additionalProperties": false,
 "properties": {
 "main.ts": {
 "type": "string",
 "description": "Main Arrow TypeScript entry file."
 },
 "main.js": {
 "type": "string",
 "description": "Main Arrow JavaScript entry file."
 },
 "main.css": {
 "type": "string",
 "description": "Optional stylesheet for the sandbox root."
 }
 },
 "anyOf": [
 { "required": ["main.ts"] },
 { "required": ["main.js"] }
 ]
 },
 "shadowDOM": {
 "type": "boolean",
 "description": "Whether the sandbox should render inside shadow DOM."
 },
 "debug": {
 "type": "boolean",
 "description": "Whether sandbox debug logging should be enabled."
 }
 },
 "required": ["source"]
 }
}`
 

 
 
 
 
 [](https://standardagents.ai)Early Access
 
 
 From the team behind
 [FormKit](https://formkit.com),
 [Tempo](https://tempo.formkit.com),
 [AutoAnimate](https://auto-animate.formkit.com),
 and
 [Drag and Drop](https://drag-and-drop.formkit.com)
 â€” Standard Agents is an open standard for creating
 domain-specific agents you can distribute and compose together to form
 safe, efficient, and effective agents. Join the early access list.

Request Early Access

You're on the list! We'll be in touch.

## Routing

The Vite scaffold uses a simple `routeToPage(url)` entry so
 the server and browser both resolve the same route tree.

- Choose a route from the incoming URL.
- Return the page status, metadata, and Arrow view together.
- Reuse the same routing function for SSR and hydration so both sides
 render the same page shape.

For browser-only routing, Arrow recommends the native
 [Navigation API](https://developer.mozilla.org/en-US/docs/Web/API/Navigation)
 via `window.navigation` when your support matrix allows it.
 It gives you a single navigation event stream and more reliable
 history traversal than wiring everything around the older
 `history.pushState()` flow. Keep a History API fallback if
 you still support older browsers.

```ts
import { html } from '@arrow-js/core'

export function routeToPage(url: string) {
  if (url === '/') {
    return {
      status: 200,
      title: 'Home',
      view: html`<main>Home</main>`,
    }
  }

  return {
    status: 404,
    title: 'Not Found',
    view: html`<main>Not found</main>`,
  }
}
```

API Reference

## @arrow-js/core

## reactive()

Creates observable state or computed values.

### Signatures

```ts
import type { Computed, Reactive, ReactiveTarget } from '@arrow-js/core'

// Observable state
declare function reactive<T extends ReactiveTarget>(data: T): Reactive<T>

// Computed value
declare function reactive<T>(effect: () => T): Computed<T>
```

### Observable state

Pass an object or array to get a reactive proxy. Property reads
 are tracked inside watchers and template expressions. Property
 writes notify observers.

```ts
import { reactive } from '@arrow-js/core'

const data = reactive({ count: 0, items: [] as string[] })

data.count++              // triggers observers
data.items.push('hello')  // array mutations trigger parent observers
```

### Computed values

Pass an arrow function to create a computed value. The expression
 re-evaluates when tracked reads change.

```ts
import { reactive } from '@arrow-js/core'

const props = reactive({ count: 2, multiplier: 10 })

const data = reactive({
  total: reactive(() => props.count * props.multiplier)
})

data.total // 20 â€” reads like a normal value, auto-updates
```

### Manual subscriptions

```ts
data.$on('count', (newVal, oldVal) => { /* ... */ })
data.$off('count', callback)
```

Prefer `watch()` or template expressions over manual
 subscriptions. Use `$on`/`$off` only when
 you need direct per-property control.

> **Rules**
> - Only objects and arrays can be reactive. Primitives cannot.
> - Nested objects are lazily made reactive on first access.
> - `reactive()` on an already-reactive object returns
 the same proxy (idempotent).

## watch()

Runs side effects that re-execute when tracked reactive reads change.

### Signatures

```ts
// Single-effect form
declare function watch<F extends () => unknown>(
  effect: F
): [returnValue: ReturnType<F>, stop: () => void]

// Getter + afterEffect form
declare function watch<F extends () => unknown, A extends (arg: ReturnType<F>) => unknown>(
  effect: F,
  afterEffect: A
): [returnValue: ReturnType<A>, stop: () => void]
```

### Parameters

- `effect` â€” A function that reads reactive properties.
 Runs immediately on creation. In the single-effect form, this is
 both the tracker and the side effect.
- `afterEffect` (optional) â€”
 Receives the return value of `effect`. Only the
 `effect` function tracks dependencies; the
 `afterEffect` runs after dependency collection.

### Returns

A tuple `[returnValue, stop]`. Call `stop()`
 to unsubscribe from all tracked dependencies.

When a watcher is created inside `component()`, Arrow
 also stops it automatically when that component unmounts.

### Examples

```ts
import { reactive, watch } from '@arrow-js/core'

const data = reactive({ price: 25, quantity: 10 })

// Single-effect: tracks and runs in one function
const [, stop] = watch(() => {
  console.log(`Total: ${data.price * data.quantity}`)
})

// Getter + effect: separates tracking from side effect
watch(
  () => data.price * data.quantity,
  (total) => console.log(`Total: ${total}`)
)

// Stop watching
stop()
```

> **Rules**
> - Dependencies are auto-discovered from reactive reads.
> - Dependencies no longer read on subsequent runs are dropped.

## html

Tagged template literal that creates an `ArrowTemplate`.

### Signature

```ts
import type { ArrowExpression, ArrowTemplate } from '@arrow-js/core'

declare function html(
  strings: TemplateStringsArray | string[],
  ...expSlots: ArrowExpression[]
): ArrowTemplate
```

Compiler output can call `html(strings, ...exprs)` directly
 with a generated `string[]`. Arrow will route it through the
 same template caching, pooling, hydration, and cleanup path as a
 tagged literal.

### Mounting

An `ArrowTemplate` is callable. Pass a parent node to
 mount into the DOM, or call with no arguments to get a
 `DocumentFragment`.

```ts
const template = html`<h1>Hello</h1>`

// Mount to a DOM node
template(document.getElementById('app'))

// Get a DocumentFragment
const fragment = template()
```

### Expression types

- **Static** â€” Any non-function value. Renders once.
 
 `html`<p>${someString}</p>``
- **Reactive** â€” A function expression. Re-evaluates
 when tracked reads change.
 
 `html`<p>${() => data.count}</p>``
- **Template / component** â€” Nest directly.
 
 `html`<div>${otherTemplate}</div>`
html`<div>${MyComponent({ label: 'hi' })}</div>``
- **Array** â€” Renders a list of templates.
 
 `html`<ul>${() => items.map(i => html`<li>${i.name}</li>`)}</ul>``

### Attribute binding

Static or reactive. Return `false` to remove the attribute.

```ts
// Static
html`<div class="${cls}"></div>`

// Reactive
html`<div class="${() => data.active ? 'on' : 'off'}"></div>`

// Boolean removal
html`<button disabled="${() => data.loading ? '' : false}">Submit</button>`
```

### Property binding

Prefix with `.` to set an IDL property instead of an attribute.

```ts
html`<input .value="${() => data.text}" />`
```

### Event binding

Prefix with `@` to attach an event listener.

```ts
html`<button @click="${(e) => handleClick(e)}">Click</button>`
```

### List keys

Call `.key()` on a template to give it stable identity
 in a list. Without keys, list patches reuse slots by position.

```ts
html`<ul>${() => items.map(item =>
  html`<li>${item.name}</li>`.key(item.id)
)}</ul>`
```

## svg

Tagged template literal for SVG child templates. It returns an
 `ArrowTemplate` just like `html`, but parses the
 template in the SVG namespace.

### Signature

```ts
import type { ArrowExpression, ArrowTemplate } from '@arrow-js/core'

declare function svg(
  strings: TemplateStringsArray | string[],
  ...expSlots: ArrowExpression[]
): ArrowTemplate
```

### When to use

Use `svg` when you need to nest SVG elements like
 `<rect>`, `<circle>`, or
 `<path>` as child templates inside an
 `<svg>`. A nested `html` template parses in
 HTML mode and will not create SVG nodes correctly.

```ts
import { html, svg } from '@arrow-js/core'

html`<svg width="100" height="100" viewBox="0 0 100 100">
  ${() => data.values.map((v, i) => svg`<rect
    x="${i * 10}"
    y="${100 - v}"
    width="9"
    height="${v}"
    fill="red"
  />`)}
</svg>`
```

`svg` uses the same mounting, reactivity, list rendering,
 keys, hydration, and cleanup behavior as `html`. The
 difference is only the parse namespace.

## component()

Wraps a factory function to provide stable local state across
 parent re-renders.

### Signatures

```ts
import type {
  ArrowTemplate,
  AsyncComponentOptions,
  Component,
  ComponentWithProps,
  Props,
  ReactiveTarget,
} from '@arrow-js/core'

// Sync â€” no props
declare function component(
  factory: () => ArrowTemplate
): Component

// Sync â€” with props
declare function component<T extends ReactiveTarget>(
  factory: (props: Props<T>) => ArrowTemplate
): ComponentWithProps<T>

// Async â€” no props
declare function component<TValue, TSnapshot = TValue>(
  factory: () => Promise<TValue> | TValue,
  options?: AsyncComponentOptions<ReactiveTarget, TValue, TSnapshot>
): Component

// Async â€” with props
declare function component<T extends ReactiveTarget, TValue, TSnapshot = TValue>(
  factory: (props: Props<T>) => Promise<TValue> | TValue,
  options?: AsyncComponentOptions<T, TValue, TSnapshot>
): ComponentWithProps<T>
```

### AsyncComponentOptions

```ts
import type { AsyncComponentOptions } from '@arrow-js/core'
```

### Usage

```ts
import { component, html, onCleanup, reactive } from '@arrow-js/core'
import type { Props } from '@arrow-js/core'

// Sync component with props
const Counter = component((props: Props<{ count: number }>) => {
  const local = reactive({ clicks: 0 })
  const onResize = () => console.log('resize')

  window.addEventListener('resize', onResize)
  onCleanup(() => window.removeEventListener('resize', onResize))

  return html`<button @click="${() => local.clicks++}">
    Root ${() => props.count} | Local ${() => local.clicks}
  </button>`
}) 

// Async component
const UserName = component(async ({ id }: { id: string }) => {
  const user = await fetch(`/api/users/${id}`).then(r => r.json())
  return user.name
})
```

### .key() for lists

Call `.key()` on the component call to preserve identity
 when rendering in a keyed list.

```ts
html`${() => items.map(item =>
  ItemCard(item).key(item.id)
)}`
```

> **Rules**
> - The factory runs **once per slot**, not on every update.
> - **Never destructure props** at the top of the factory â€”
 read them lazily inside reactive expressions.
> - `Props<T>` is a live proxy over the source object, so
 checks like `'count' in props` and
 `Object.keys(props)` reflect the current source keys.
> - SSR waits for all async components to resolve before returning HTML.
> - JSON-safe async results are auto-serialized into the hydration payload.

## onCleanup()

Registers teardown work for the current component instance.

### Signature

```ts
declare function onCleanup(fn: () => void): () => void
```

### Behavior

- Call it inside `component()` while setting up local
 side effects.
- Arrow runs the cleanup automatically when that component slot
 unmounts.
- It also returns a disposer so you can stop the side effect early.

### Example

```ts
import { component, html, onCleanup } from '@arrow-js/core'

const ResizeProbe = component(() => {
  const onResize = () => console.log(window.innerWidth)

  window.addEventListener('resize', onResize)
  onCleanup(() => window.removeEventListener('resize', onResize))

  return html`<div>Watching resizeâ€¦</div>`
})
```

> **Tip**
> Use `onCleanup()` for manual subscriptions like DOM
 listeners, timers, sockets, or anything else Arrow did not create
 for you.

## pick() / props()

Narrows a reactive object down to specific keys. `props`
 is an alias for `pick`.

### Signatures

```ts
declare function pick<T extends object, K extends keyof T>(
  source: T,
  ...keys: K[]
): Pick<T, K>

declare function pick<T extends object>(source: T): T

const props = pick  // alias
```

### Usage

```ts
import { pick, reactive } from '@arrow-js/core'

const state = reactive({ count: 1, theme: 'dark', locale: 'en' })

// Pass only the keys a component needs
html`${Counter(pick(state, 'count'))}`

// Without keys â€” returns the source as-is
html`${Counter(pick(state))}`
```

> **Tip**
> The returned object is a live proxy â€” reads and writes flow
 through to the source. It is not a copy.

## nextTick()

Flushes Arrow's internal microtask queue, then runs an optional
 callback.

### Signature

```ts
declare function nextTick(fn?: CallableFunction): Promise<unknown>
```

### Usage

```ts
import { nextTick, reactive } from '@arrow-js/core'

const data = reactive({ count: 0 })

data.count = 5

// Wait for all pending reactive updates to flush
await nextTick()
// DOM is now updated

// Or pass a callback
nextTick(() => {
  console.log('DOM updated')
})
```

Arrow batches reactive updates into a microtask.
 `nextTick` lets you wait for that flush before reading
 the DOM or performing follow-up work.

## @arrow-js/framework

## render()

Full-lifecycle render that mounts a view into a root element,
 tracking async components and boundaries.

### Signature

```ts
import type { RenderOptions, RenderResult } from '@arrow-js/framework'

declare function render(
  root: ParentNode,
  view: unknown,
  options?: RenderOptions
): Promise<RenderResult>
```

### RenderOptions

```ts
import type { RenderOptions } from '@arrow-js/framework'
```

### RenderResult

```ts
import type { RenderPayload, RenderResult } from '@arrow-js/framework'
```

### Usage

```ts
import { render } from '@arrow-js/framework'
import { html } from '@arrow-js/core'

const view = html`<h1>Hello</h1>`
const { root, payload } = await render(document.getElementById('app'), view)
```

## boundary()

Wraps a view in hydration boundary markers, enabling targeted
 recovery during hydration.

### Signature

```ts
import type { ArrowTemplate } from '@arrow-js/core'
import type { BoundaryOptions } from '@arrow-js/framework'

declare function boundary(
  view: unknown,
  options?: BoundaryOptions
): ArrowTemplate
```

### Usage

```ts
import { boundary } from '@arrow-js/framework'
import { html } from '@arrow-js/core'

html`
  <main>
    ${boundary(Sidebar(), { idPrefix: 'sidebar' })}
    ${boundary(Content(), { idPrefix: 'content' })}
  </main>
`
```

This inserts `<template data-arrow-boundary-start/end>`
 markers in the HTML. During hydration, if a subtree mismatches,
 Arrow repairs that boundary region instead of replacing the
 entire root.

> **When to use**
> Always wrap async components in a boundary for SSR/hydration
 recovery. Also useful around any subtree that may diverge
 between server and client (e.g. time-dependent content).

## toTemplate()

Normalizes any view value into an `ArrowTemplate`.
 Useful when you have a value that might be a string, number,
 template, or component call and need a consistent template type.

### Signature

```ts
import type { ArrowTemplate } from '@arrow-js/core'

declare function toTemplate(view: unknown): ArrowTemplate
```

### Usage

```ts
import { toTemplate } from '@arrow-js/framework'
import { html } from '@arrow-js/core'

const view = 'Hello, world'
const template = toTemplate(view)

// Now usable anywhere an ArrowTemplate is expected
template(document.getElementById('app'))
```

## renderDocument()

Injects rendered HTML, head content, and payload script into an
 HTML shell template string. Used in custom server setups.

### Signature

```ts
import type { DocumentRenderParts } from '@arrow-js/framework'

declare function renderDocument(
  template: string,
  parts: DocumentRenderParts
): string
```

### Placeholder markers

The `template` string should contain these HTML comment
 placeholders:

- `<!--app-head-->` â€” replaced with `parts.head`
- `<!--app-html-->` â€” replaced with `parts.html`
- `<!--app-payload-->` â€” replaced with `parts.payloadScript`

## @arrow-js/ssr

## renderToString()

Renders a view to an HTML string on the server. Waits for all
 async components to resolve before returning.

This is the main SSR entry point. Use it inside your request handler
 after you have chosen the page and built the Arrow view for the
 incoming URL.

### Signature

```ts
import type {
  HydrationPayload,
  SsrRenderOptions,
  SsrRenderResult,
} from '@arrow-js/ssr'

declare function renderToString(
  view: unknown,
  options?: SsrRenderOptions
): Promise<SsrRenderResult>
```

### Usage

```ts
import { renderToString, serializePayload } from '@arrow-js/ssr'

const { html, payload } = await renderToString(view)

// Serialize payload for client-side hydration
const script = serializePayload(payload)
```

### Typical server flow

```ts
import { renderToString, serializePayload } from '@arrow-js/ssr'

export async function renderPage(url: string) {
  const page = routeToPage(url)
  const result = await renderToString(page.view)

  return [
    '<!doctype html>',
    '<html>',
    '  <head>',
    `    <title>${page.title}</title>`,
    '  </head>',
    '  <body>',
    `    <div id="app">${result.html}</div>`,
    `    ${serializePayload(result.payload)}`,
    '  </body>',
    '</html>'
  ].join('\n')
}
```

Internally uses JSDOM to render templates into a virtual DOM,
 then serializes the result. All async components are awaited
 and their results captured in the payload.

## serializePayload()

Serializes a hydration payload into a
 `<script type="application/json">` tag that can
 be embedded in the HTML document.

### Signature

```ts
declare function serializePayload(
  payload: unknown,
  id?: string  // default: 'arrow-ssr-payload'
): string
```

### Returns

An HTML string containing a `<script>` tag with
 the JSON-serialized payload. The `id` attribute matches
 what `readPayload()` looks for on the client.

```ts
const payload = { rootId: 'app', async: {}, boundaries: [] }

const defaultScript = serializePayload(payload)
// <script id="arrow-ssr-payload" type="application/json">{...}</script>

// Custom id
const customScript = serializePayload(payload, 'my-payload')
// <script id="my-payload" type="application/json">{...}</script>
```

> **Tip**
> The serializer escapes `</script>` sequences
 inside the JSON to prevent injection.

## @arrow-js/hydrate

## hydrate()

Reconciles server-rendered HTML with the client-side view tree,
 reconnecting reactivity without replacing existing DOM nodes.

Call it once in your browser entry after reading the server payload
 and rebuilding the same page view that was used during SSR.

### Signature

```ts
import type {
  HydrationOptions,
  HydrationPayload,
  HydrationResult,
} from '@arrow-js/hydrate'

declare function hydrate(
  root: ParentNode,
  view: unknown,
  payload?: HydrationPayload,
  options?: HydrationOptions
): Promise<HydrationResult>
```

### HydrationOptions

```ts
import type {
  HydrationMismatchDetails,
  HydrationOptions,
} from '@arrow-js/hydrate'
```

### HydrationResult

```ts
import type { HydrationResult } from '@arrow-js/hydrate'
```

### Usage

```ts
import { hydrate, readPayload } from '@arrow-js/hydrate'
import { createApp } from './app'

const payload = readPayload()
const root = document.getElementById('app')!

const result = await hydrate(root, createApp(), payload, {
  onMismatch: (details) => {
    console.warn('Hydration mismatch:', details)
  }
})
```

### Typical client flow

```ts
import { hydrate, readPayload } from '@arrow-js/hydrate'

const payload = readPayload()
const root = document.getElementById(payload.rootId ?? 'app')

if (!root) {
  throw new Error('Missing #app root')
}

await hydrate(
  root,
  routeToPage(window.location.pathname).view,
  payload
)
```

When the server HTML matches the client view, Arrow adopts the
 existing DOM nodes and attaches reactive bindings. When a
 mismatch is detected, boundary regions are repaired individually
 before falling back to a full root replacement.

## readPayload()

Reads the hydration payload from a
 `<script type="application/json">` tag embedded
 in the document by the server.

### Signature

```ts
declare function readPayload(
  doc?: Document,  // default: document
  id?: string      // default: 'arrow-ssr-payload'
): HydrationPayload
```

### Usage

```ts
import { readPayload } from '@arrow-js/hydrate'

// Default â€” reads from document, id="arrow-ssr-payload"
const payload = readPayload()

// Custom document and id
const iframe = document.querySelector('iframe')
const payloadFromFrame = iframe?.contentDocument
  ? readPayload(iframe.contentDocument, 'my-payload')
  : null
```

## @arrow-js/sandbox

## sandbox()

Returns an `ArrowTemplate` that renders a stable
 `<arrow-sandbox>` host element and boots a QuickJS +
 WASM VM behind it.

### Signature

```ts
import type { ArrowTemplate } from '@arrow-js/core'

type HostBridgeFn = (...args: unknown[]) => unknown | Promise<unknown>
type HostBridgeModule = Record<string, HostBridgeFn>
type HostBridge = Record<string, HostBridgeModule>

interface SandboxProps {
  source: Record<string, string>
  shadowDOM?: boolean;
  onError?: (error: Error | string) => void;
  debug?: boolean;
}

interface SandboxEvents {
  output?: (payload: unknown) => void;
}

declare function sandbox<T extends {
  source: object;
  shadowDOM?: boolean;
  onError?: (error: Error | string) => void;
  debug?: boolean;
}>(
  props: T,
  events?: SandboxEvents,
  hostBridge?: HostBridge
): ArrowTemplate
```

### Rules

- `source` must contain exactly one
 `main.ts` or `main.js` entry file.
- `main.css` is optional and is injected into the sandbox
 host root. By default that root is an open shadow root.
- Pass `shadowDOM: false` to render into the custom
 elementâ€™s light DOM instead.
- Use the optional second argument to receive
 `output(payload)` calls from inside the sandbox.
- Use the optional third argument to expose host bridge modules that
 sandbox code can import directly.

### Usage

```ts
import { html } from '@arrow-js/core'
import { sandbox } from '@arrow-js/sandbox'

const source = {
  'main.ts': [
    "import { html, reactive } from '@arrow-js/core'",
    "import { formatCount } from 'host-bridge:demo'",
    '',
    'const state = reactive({ count: 0 })',
    '',
    'export default html`<button @click="${() => state.count++}">',
    '  ${() => formatCount(state.count)}',
    '</button>`',
  ].join('\n'),
}

html`<main>${sandbox({ source }, {
  output(payload) {
    console.log(payload)
  },
}, {
  'host-bridge:demo': {
    formatCount(count) {
      return 'Count ' + count
    },
  },
})}</main>`
```

> **Security Model**
> User-authored Arrow code runs inside QuickJS/WASM. The host page
 only mounts trusted DOM and forwards sanitized event payloads. It
 does not run user callbacks in the window realm.

## Type Reference

All types are exported from their respective packages. Import them
 with the `type` keyword for type-only imports.

### @arrow-js/core

```ts
export type ParentNode = Node | DocumentFragment

export interface ArrowTemplate {
  (parent: ParentNode): ParentNode
  (): DocumentFragment
  isT: boolean
  key: (key: ArrowTemplateKey) => ArrowTemplate
  id: (id: ArrowTemplateId) => ArrowTemplate
  _c: () => Chunk
  _k: ArrowTemplateKey
  _i?: ArrowTemplateId
}

export type ArrowTemplateKey = string | number | undefined
type ArrowTemplateId = string | number | undefined

export type ArrowRenderable =
  | string
  | number
  | boolean
  | null
  | undefined
  | ComponentCall
  | ArrowTemplate
  | Array<string | number | boolean | ComponentCall | ArrowTemplate>

export type ArrowFunction = (...args: unknown[]) => ArrowRenderable

export type ArrowExpression =
  | ArrowRenderable
  | ArrowFunction
  | EventListener
  | ((evt: InputEvent) => void)

export type ReactiveTarget = Record<PropertyKey, unknown> | unknown[]

interface ReactiveAPI<T> {
  $on: <P extends keyof T>(p: P, c: PropertyObserver<T[P]>) => void
  $off: <P extends keyof T>(p: P, c: PropertyObserver<T[P]>) => void
}

export interface Computed<T> extends Readonly<Reactive<{ value: T }>> {}

type ReactiveValue<T> = T extends Computed<infer TValue>
  ? TValue
  : T extends ReactiveTarget
    ? Reactive<T> | T
    : T

export type Reactive<T extends ReactiveTarget> = {
  [P in keyof T]: ReactiveValue<T[P]>
} & ReactiveAPI<T>

export interface PropertyObserver<T> {
  (newValue?: T, oldValue?: T): void
}

export type Props<T extends ReactiveTarget> = {
  [P in keyof T]: T[P] extends ReactiveTarget ? Props<T[P]> | T[P] : T[P]
}
export type EventMap = Record<string, unknown>

export type EventMap = Record<string, unknown>

export type Events<T extends EventMap> = {
  [K in keyof T]?: (payload: T[K]) => void
}

export type Emit<T extends EventMap> = <K extends keyof T>(
  event: K,
  payload: T[K]
) => void

export type ComponentFactory = (
  props?: Props<ReactiveTarget>,
  emit?: Emit<EventMap>
) => ArrowTemplate

export interface AsyncComponentOptions<
  TProps extends ReactiveTarget,
  TValue,
  TEvents extends EventMap = EventMap,
  TSnapshot = TValue,
> {
  fallback?: unknown
  onError?: (
    error: unknown,
    props: Props<TProps>,
    emit: Emit<TEvents>
  ) => unknown
  render?: (
    value: TValue,
    props: Props<TProps>,
    emit: Emit<TEvents>
  ) => unknown
  serialize?: (
    value: TValue,
    props: Props<TProps>,
    emit: Emit<TEvents>
  ) => TSnapshot
  deserialize?: (snapshot: TSnapshot, props: Props<TProps>) => TValue
  idPrefix?: string
}

export interface ComponentCall {
  h: ComponentFactory
  p: Props<ReactiveTarget> | undefined
  e: Events<EventMap> | undefined
  k: ArrowTemplateKey
  key: (key: ArrowTemplateKey) => ComponentCall
}

export interface Component<TEvents extends EventMap = EventMap> {
  (props?: undefined, events?: Events<TEvents>): ComponentCall
}

export interface ComponentWithProps<
  T extends ReactiveTarget,
  TEvents extends EventMap = EventMap,
> {
  <S extends T>(props: S, events?: Events<TEvents>): ComponentCall
}
```

### @arrow-js/framework

```ts
export interface RenderOptions {
  clear?: boolean
  hydrationSnapshots?: Record<string, unknown>
}

export interface RenderPayload {
  async: Record<string, unknown>
  boundaries: string[]
}

export interface RenderResult {
  root: ParentNode
  template: ArrowTemplate
  payload: RenderPayload
}

export interface BoundaryOptions {
  idPrefix?: string
}

export interface DocumentRenderParts {
  head?: string
  html: string
  payloadScript?: string
}
```

### @arrow-js/ssr

```ts
export interface HydrationPayload {
  html?: string
  rootId?: string
  async?: Record<string, unknown>
  boundaries?: string[]
}

export interface SsrRenderOptions {
  rootId?: string
}

export interface SsrRenderResult {
  html: string
  payload: HydrationPayload
}
```

### @arrow-js/hydrate

```ts
export interface HydrationPayload {
  html?: string
  rootId?: string
  async?: Record<string, unknown>
  boundaries?: string[]
}

export interface HydrationMismatchDetails {
  actual: string
  expected: string
  mismatches: number
  repaired: boolean
  boundaryFallbacks: number
}

export interface HydrationOptions {
  onMismatch?: (details: HydrationMismatchDetails) => void
}

export interface HydrationResult {
  root: ParentNode
  template: ArrowTemplate
  payload: RenderPayload
  adopted: boolean
  mismatches: number
  boundaryFallbacks: number
}
```

### @arrow-js/sandbox

```ts
export interface SandboxProps {
  source: Record<string, string>
  shadowDOM?: boolean
  onError?: (error: Error | string) => void
  debug?: boolean
}

export interface SandboxEvents {
  output?: (payload: unknown) => void
}

export function sandbox<T extends {
  source: object
  shadowDOM?: boolean
  onError?: (error: Error | string) => void
  debug?: boolean
}>(
  props: T,
  events?: SandboxEvents,
  hostBridge?: HostBridge
): ArrowTemplate {
  ensureSandboxElement()
  return html`${SandboxHostComponent({
    config: props as SandboxHostProps,
    events,
    hostBridge,
  })}`
}
```
