# @vibecanvas/sdk

SDK for the new Vibecanvas split:

- actor server code uses `@vibecanvas/sdk/actor`
- widget UI code uses `@vibecanvas/sdk/widget`
- widget UI talks to the host through an injected bridge, never through Automerge actor state

## Actor server

```ts
import { defineActor } from '@vibecanvas/sdk/actor';

export default defineActor({
  slug: 'todo',
  name: 'Todo',
  version: '0.1.0',
  initialState: 'ready',
  initialContext: { items: [] },
  on: {
    'todo.add': async ({ context, input }) => ({
      state: 'ready',
      context: { ...context, items: [...context.items, input] },
      outputs: [],
    }),
  },
});
```

## Widget UI

```ts
import { defineWidget, useActor } from '@vibecanvas/sdk/widget';

export default defineWidget(({ root }) => {
  const actor = useActor();

  actor.onState((next) => {
    root.textContent = JSON.stringify(next.context);
  });

  void actor.send('todo.add', { title: 'new task' });
});
```

## Config

```ts
import { defineVibecanvasConfig } from '@vibecanvas/sdk';
import todoActor from './todo.actor';

export default defineVibecanvasConfig({
  actors: [todoActor],
  widgets: [{
    slug: 'todo',
    name: 'Todo',
    version: '0.1.0',
    source: { 'main.ts': './widget.ts' },
  }],
});
```

Actor state, messages, outputs, and connections are host/API state. Canvas Automerge data stores only visual widget host data and actor binding ids.
