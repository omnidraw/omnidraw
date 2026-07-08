# Arrow JS essentials for widgets

Widget UI uses `@arrow-js/core` inside an Arrow sandbox. Use plain TypeScript and `html` tagged templates. Do not use React, JSX, Solid, Vue, or Svelte.

## Imports

```ts
import { html, reactive } from "@arrow-js/core";
import { actor } from "@vibecanvas/sdk/widget";
```

Use only widget-safe imports. Do not import backend packages, host internals, node modules, filesystem APIs, ORPC clients, Automerge, or `@vibecanvas/sdk` without `/widget`.

## Reactive values

Use `reactive()` for local widget state:

```ts
const ui = reactive({ title: "" });
```

In templates, wrap reactive reads in functions so Arrow can update them:

```ts
html`<span>${() => ui.title}</span>`
```

A plain expression like `${ui.title}` renders only once.

## Events

Use event bindings with `@event` attributes:

```ts
html`<button @click="${() => actor.sendMessage("in.clear", {})}">Clear</button>`
```

For forms, prevent default submission:

```ts
html`
  <form @submit="${(event: Event) => { event.preventDefault(); void save(); }}">
    <button type="submit">Save</button>
  </form>
`
```

## Inputs

Keep local input state in `reactive()` and send JSON payloads to the actor:

```ts
const ui = reactive({ title: "" });

const add = async () => {
  const title = ui.title.trim();
  if (!title) return;
  await actor.sendMessage("in.addTodo", { title });
  ui.title = "";
};

html`
  <input
    value="${() => ui.title}"
    @input="${(event: Event) => {
      ui.title = (event.target as HTMLInputElement).value;
    }}"
  />
  <button @click="${() => void add()}">Add</button>
`
```

## Lists

Return arrays of templates for lists. Use `.key(id)` when items can be reordered or updated.

```ts
html`
  <ul>
    ${() => todos().map((todo) => html`
      <li>${todo.title}</li>
    `.key(todo.id))}
  </ul>
`
```

## Actor data

`actor.context.value` can be null or incomplete on first render. Always provide fallbacks.

```ts
const todos = () => ((actor.context.value as any)?.todos ?? []);
const state = () => actor.state.value;
```

Send only manifest-declared input messages:

```ts
await actor.sendMessage("in.toggleTodo", { id: todo.id });
```

## Export

Export one default `html` template from `widget/main.ts`:

```ts
export default html`
  <section class="my-widget">
    <strong>${() => actor.state.value}</strong>
  </section>
`;
```
