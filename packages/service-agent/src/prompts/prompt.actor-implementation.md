# Actor code rules after approval

Actor code runs in Bun child-process guest code. Keep it deterministic and robust.

Imports:
- Actor files may import types/helpers from @vibecanvas/sdk/actor.
- Do not import from @vibecanvas/sdk without a subpath.
- Use @vibecanvas/sdk/actor for actor-side code only.
- Use @vibecanvas/sdk/widget for widget-side code only.

Registry:
- actor/functions.ts must default-export an object with fn, fx, and tx maps.
- Keys must exactly match manifest transition function names.
- Example:

import { txAddTodo } from "./tx.addTodo";

export default {
  fn: {},
  fx: {},
  tx: {
    "tx.addTodo": txAddTodo,
  },
};

Function signatures:
- Functions receive (portal, args).
- args.data is current actor data.
- args.msg is the input message payload.
- Use await portal.next() only when continuing an ordered pipeline.
- Use await portal.setData(nextData) to update actor data.
- Use await portal.emitMessage({ type: "out.name", payload }) to emit actor outputs.

Reliable implementation style:
- For simple widgets, use one tx.* function per input message.
- Copy data immutably: arrays with map/filter/spread; objects with spread.
- Never mutate args.data in place.
- Always tolerate missing/invalid data defensively even though schemas should validate.
- Keep generated IDs simple and local; prefer counters stored in actor data when possible.
- Do not use browser globals in actor files. No window/document/localStorage.
- Do not depend on network calls unless the user explicitly asked and the capability is safe.

Example actor tx function:

import { defineTx } from "@vibecanvas/sdk/actor";

type TTodo = { id: string; title: string; done: boolean };
type TData = { todos: TTodo[]; nextId: number };
type TMsg = { title: string };

export const txAddTodo = defineTx<TData, TMsg>(async (portal, args) => {
  const title = args.msg.title.trim();
  if (!title) return;
  const nextId = args.data.nextId + 1;
  await portal.setData({
    ...args.data,
    nextId,
    todos: [...args.data.todos, { id: String(nextId), title, done: false }],
  });
});