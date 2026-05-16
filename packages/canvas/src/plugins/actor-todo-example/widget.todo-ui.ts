import type { TActorInstance } from "@vibecanvas/api-actors/contract";
import type { TOrpcSafeClient } from "@vibecanvas/orpc-client";
import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import type { ActorConnectionService, CrdtService } from "../../services";

type TTodoItem = {
  id: string;
  title: string;
  completed: boolean;
};

type TMountTodoWidgetArgs = {
  root: HTMLDivElement;
  element: TElement;
  crdt: CrdtService;
  actorConnection: ActorConnectionService;
  apiService: TOrpcSafeClient;
};

function getActorInstanceId(args: { crdt: CrdtService; elementId: string }) {
  const element = args.crdt.doc()?.elements[args.elementId];
  return element?.data.type === "widget" ? element.data.actorInstanceId ?? null : null;
}

function getTodoItems(instance: TActorInstance | null): TTodoItem[] {
  const items = instance?.machine_context.items;
  if (!Array.isArray(items)) return [];

  return items.filter((item): item is TTodoItem => {
    return typeof item === "object"
      && item !== null
      && typeof (item as TTodoItem).id === "string"
      && typeof (item as TTodoItem).title === "string"
      && typeof (item as TTodoItem).completed === "boolean";
  });
}

export function mountTodoWidget(args: TMountTodoWidgetArgs) {
  let actorInstanceId = getActorInstanceId({ crdt: args.crdt, elementId: args.element.id });
  let instance: TActorInstance | null = actorInstanceId
    ? args.actorConnection.getInstances().find((candidate) => candidate.id === actorInstanceId) ?? null
    : null;
  let disposed = false;

  args.root.style.background = "#0f172a";
  args.root.style.color = "#e2e8f0";
  args.root.style.fontFamily = "Inter, ui-sans-serif, system-ui, sans-serif";

  const send = async (eventName: string, params: Record<string, unknown> = {}) => {
    actorInstanceId = getActorInstanceId({ crdt: args.crdt, elementId: args.element.id });
    if (!actorInstanceId) return;
    await args.apiService.api.actors.messages.send({ actorInstanceId, eventName, params });
  };

  const render = () => {
    if (disposed) return;
    actorInstanceId = getActorInstanceId({ crdt: args.crdt, elementId: args.element.id });
    instance = actorInstanceId
      ? args.actorConnection.getInstances().find((candidate) => candidate.id === actorInstanceId) ?? instance
      : null;

    const items = getTodoItems(instance);
    args.root.innerHTML = "";

    const shell = document.createElement("div");
    shell.style.display = "flex";
    shell.style.flexDirection = "column";
    shell.style.gap = "10px";
    shell.style.height = "100%";
    shell.style.boxSizing = "border-box";
    shell.style.padding = "12px";

    const title = document.createElement("div");
    title.textContent = actorInstanceId ? "Actor Todo" : "Creating Todo actor…";
    title.style.fontWeight = "700";
    shell.appendChild(title);

    const form = document.createElement("form");
    form.style.display = "flex";
    form.style.gap = "6px";
    const input = document.createElement("input");
    input.placeholder = "New task";
    input.style.flex = "1";
    input.style.border = "1px solid #334155";
    input.style.borderRadius = "8px";
    input.style.padding = "8px";
    input.style.background = "#020617";
    input.style.color = "#e2e8f0";
    const add = document.createElement("button");
    add.type = "submit";
    add.textContent = "Add";
    add.style.border = "0";
    add.style.borderRadius = "8px";
    add.style.padding = "8px 10px";
    add.style.background = "#38bdf8";
    add.style.color = "#082f49";
    add.style.fontWeight = "700";
    form.append(input, add);
    form.onsubmit = (event) => {
      event.preventDefault();
      const title = input.value.trim();
      if (!title) return;
      input.value = "";
      void send("todo.add", { title });
    };
    shell.appendChild(form);

    const list = document.createElement("div");
    list.style.display = "flex";
    list.style.flexDirection = "column";
    list.style.gap = "6px";
    list.style.overflow = "auto";

    items.forEach((item) => {
      const row = document.createElement("div");
      row.style.display = "flex";
      row.style.alignItems = "center";
      row.style.gap = "8px";
      row.style.background = "#111827";
      row.style.borderRadius = "8px";
      row.style.padding = "7px";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = item.completed;
      checkbox.onchange = () => void send("todo.toggle", { id: item.id });

      const label = document.createElement("span");
      label.textContent = item.title;
      label.style.flex = "1";
      label.style.textDecoration = item.completed ? "line-through" : "none";
      label.style.opacity = item.completed ? "0.6" : "1";

      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "×";
      remove.style.border = "0";
      remove.style.borderRadius = "6px";
      remove.style.background = "#334155";
      remove.style.color = "#e2e8f0";
      remove.onclick = () => void send("todo.remove", { id: item.id });

      row.append(checkbox, label, remove);
      list.appendChild(row);
    });

    shell.appendChild(list);

    const clear = document.createElement("button");
    clear.type = "button";
    clear.textContent = "Clear completed";
    clear.style.marginTop = "auto";
    clear.style.border = "1px solid #334155";
    clear.style.borderRadius = "8px";
    clear.style.padding = "8px";
    clear.style.background = "transparent";
    clear.style.color = "#e2e8f0";
    clear.onclick = () => void send("todo.clearCompleted");
    shell.appendChild(clear);

    args.root.appendChild(shell);
  };

  const removeCrdtListener = args.crdt.hooks.change.tap(render);
  const removeActorListener = args.actorConnection.hooks.change.tap(render);

  if (actorInstanceId) {
    void args.apiService.api.actors.instances.get({ id: actorInstanceId }).then(([error, next]) => {
      if (!error && next) {
        instance = next;
        args.actorConnection.upsertInstance(next);
        render();
      }
    });
  }
  render();

  return () => {
    disposed = true;
    removeCrdtListener();
    removeActorListener();
    args.root.innerHTML = "";
  };
}
