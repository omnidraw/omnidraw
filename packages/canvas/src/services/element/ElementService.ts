import type { IService } from "@vibecanvas/runtime";
import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import type { ThemeService } from "@vibecanvas/service-theme";
import { SyncHook } from "@vibecanvas/tapable";
import {
  createProjectionRegistry,
  type ProjectionRegistry,
} from "../../engine/projection/ProjectionRegistry";
import { fnProjectWidgetElementWithChrome } from "../../engine/projection/projectors/fn.widget-chrome";
import type { TCrdtBuilder } from "../crdt/fxBuilder";
import { fnMergeSelectionStyleMenuConfigs } from "./fn-merge-selection-style-menu-configs";
import type {
  TElementElementDefinition,
  TElementServiceHooks,
  TElementTransformPolicy,
} from "./types";
export * from "./types";

function sortDefinitions(
  definitions: readonly TElementElementDefinition[],
): TElementElementDefinition[] {
  return [...definitions].sort((left, right) => {
    return (left.priority ?? 0) - (right.priority ?? 0)
      || left.id.localeCompare(right.id);
  });
}

/**
 * Registry for product element policy and optional projection extensions.
 * Persisted elements are the only input; renderer nodes never enter this API.
 */
export class ElementService implements IService<TElementServiceHooks> {
  readonly name = "element";
  readonly hooks: TElementServiceHooks = {
    elementsChange: new SyncHook(),
  };

  readonly #definitions = new Map<string, TElementElementDefinition>();

  registerElement(definition: TElementElementDefinition): () => void {
    if (definition.id.trim().length === 0) {
      throw new TypeError("Element definition ID must be non-empty.");
    }
    if (this.#definitions.has(definition.id)) {
      throw new TypeError(
        `Element definition '${definition.id}' is already registered.`,
      );
    }
    this.#definitions.set(definition.id, definition);
    this.hooks.elementsChange.call();
    let registered = true;
    return () => {
      if (!registered) {
        return;
      }
      registered = false;
      this.unregisterElement(definition.id);
    };
  }

  unregisterElement(id: string): void {
    if (!this.#definitions.delete(id)) {
      return;
    }
    this.hooks.elementsChange.call();
  }

  getDefinitions(): readonly TElementElementDefinition[] {
    return sortDefinitions([...this.#definitions.values()]);
  }

  /**
   * Requests a fresh derived projection when an extension's view-only state
   * changes without changing its registered definition or the CRDT document.
   */
  invalidateProjection(): void {
    this.hooks.elementsChange.call();
  }

  getMatchingElementDefinitionsByElement(
    element: TElement,
  ): readonly TElementElementDefinition[] {
    return this.getDefinitions().filter((definition) => {
      return definition.matchesElement(element);
    });
  }

  getSelectionStyleMenuConfigByElement(args: {
    element: TElement;
    theme?: ThemeService;
  }) {
    return fnMergeSelectionStyleMenuConfigs(
      this.getMatchingElementDefinitionsByElement(args.element).map(
        (definition) => definition.getSelectionStyleMenu?.({
          element: args.element,
          theme: args.theme,
        }),
      ),
    );
  }

  getSelectionStyleMenuConfigById(args: {
    id: string;
    theme?: ThemeService;
  }) {
    return fnMergeSelectionStyleMenuConfigs(
      this.getDefinitions()
        .filter((definition) => definition.id === args.id)
        .map((definition) => definition.getSelectionStyleMenu?.({
          theme: args.theme,
        })),
    );
  }

  getTransformPolicy(args: {
    element: TElement;
    selection: readonly TElement[];
  }): TElementTransformPolicy {
    return this.getMatchingElementDefinitionsByElement(args.element)
      .reduce<TElementTransformPolicy>(
      (policy, definition) => {
        return {
          ...policy,
          ...(definition.getTransformPolicy?.(args) ?? {}),
        };
      },
      {
        handles: [
          "move",
          "rotate",
          "resize-n",
          "resize-ne",
          "resize-e",
          "resize-se",
          "resize-s",
          "resize-sw",
          "resize-w",
          "resize-nw",
        ],
        keepAspectRatio: false,
        allowFlip: false,
        allowRotate: true,
      },
    );
  }

  prepareClone(args: {
    source: TElement;
    clone: TElement;
    createId(): string;
  }): TElement | null {
    let clone = args.clone;
    for (
      const definition of this.getMatchingElementDefinitionsByElement(
        args.source,
      )
    ) {
      const data = definition.prepareCloneData?.({
        source: args.source,
        clone,
        createId: args.createId,
      });
      if (data === null) {
        return null;
      }
      if (data !== undefined) {
        clone = { ...clone, data } as TElement;
      }
    }
    return clone;
  }

  projectionExtensions(): ProjectionRegistry {
    return createProjectionRegistry(
      this.getDefinitions().flatMap((definition) => {
        const projections = definition.projection === undefined
          ? []
          : [definition.projection];
        if (definition.getWidgetChrome === undefined) {
          return projections;
        }
        return [
          ...projections,
          {
            id: `widget-chrome:${definition.id}`,
            priority: 1_000 + (definition.priority ?? 0),
            matchesElement: (element: TElement) => {
              return (
                element.data.type === "ui-widget"
                || element.data.type === "widget-instance"
              ) && definition.matchesElement(element);
            },
            project: (projection) => {
              return fnProjectWidgetElementWithChrome({
                projection,
                chrome: definition.getWidgetChrome?.({
                  element: projection.element,
                }) ?? {},
              });
            },
          },
        ];
      }),
    );
  }

  deleteElement(
    element: TElement,
    builder: TCrdtBuilder,
  ): TCrdtBuilder {
    const definitions = this.getMatchingElementDefinitionsByElement(element);
    return builder.deleteElement(element.id, {
      onCommit: ({ entity }) => {
        for (const definition of definitions) {
          definition.onDelete?.(entity);
        }
      },
      onRollback: ({ entity }) => {
        for (const definition of definitions) {
          definition.onRestore?.(entity);
        }
      },
    });
  }
}
