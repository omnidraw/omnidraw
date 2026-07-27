import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import { fnProjectImageElement } from "./projectors/fn.image";
import { fnProjectPenElement } from "./projectors/fn.pen";
import { fnProjectShape1dElement } from "./projectors/fn.shape1d";
import { fnProjectShape2dElement } from "./projectors/fn.shape2d";
import { fnProjectTextElement } from "./projectors/fn.text";
import { fnProjectWidgetElement } from "./projectors/fn.widget";
import type { TCanvasProjectionDefinition } from "./typed";

export type ProjectionRegistry = {
  readonly definitions: readonly TCanvasProjectionDefinition[];
};

function sortDefinitions(
  definitions: readonly TCanvasProjectionDefinition[],
): TCanvasProjectionDefinition[] {
  return [...definitions].sort((left, right) => {
    return right.priority - left.priority || left.id.localeCompare(right.id);
  });
}

export function createProjectionRegistry(
  definitions: readonly TCanvasProjectionDefinition[] = [],
): ProjectionRegistry {
  const ids = new Set<string>();
  for (const definition of definitions) {
    if (ids.has(definition.id)) {
      throw new TypeError(`Duplicate canvas projection definition '${definition.id}'.`);
    }
    ids.add(definition.id);
  }
  return {
    definitions: Object.freeze(sortDefinitions(definitions)),
  };
}

export function registerProjectionDefinition(
  registry: ProjectionRegistry,
  definition: TCanvasProjectionDefinition,
): ProjectionRegistry {
  return createProjectionRegistry([...registry.definitions, definition]);
}

export function resolveProjectionDefinition(
  registry: ProjectionRegistry,
  element: TElement,
): TCanvasProjectionDefinition | null {
  return registry.definitions.find((definition) => definition.matchesElement(element)) ?? null;
}

export function createBuiltInProjectionRegistry(): ProjectionRegistry {
  return createProjectionRegistry([
    {
      id: "builtin.shape2d",
      priority: 100,
      matchesElement: (element) => {
        return element.data.type === "rect"
          || element.data.type === "ellipse"
          || element.data.type === "diamond";
      },
      project: fnProjectShape2dElement,
    },
    {
      id: "builtin.shape1d",
      priority: 100,
      matchesElement: (element) => {
        return element.data.type === "line" || element.data.type === "arrow";
      },
      project: fnProjectShape1dElement,
    },
    {
      id: "builtin.pen",
      priority: 100,
      matchesElement: (element) => element.data.type === "pen",
      project: fnProjectPenElement,
    },
    {
      id: "builtin.text",
      priority: 100,
      matchesElement: (element) => element.data.type === "text",
      project: fnProjectTextElement,
    },
    {
      id: "builtin.image",
      priority: 100,
      matchesElement: (element) => element.data.type === "image",
      project: fnProjectImageElement,
    },
    {
      id: "builtin.widget",
      priority: 100,
      matchesElement: (element) => {
        return element.data.type === "ui-widget"
          || element.data.type === "widget-instance";
      },
      project: fnProjectWidgetElement,
    },
  ]);
}
