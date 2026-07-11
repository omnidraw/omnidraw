import type { IService } from "@vibecanvas/runtime";
import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import type { ThemeService } from "@vibecanvas/service-theme";
import { SyncHook } from "@vibecanvas/tapable";
import type Konva from "konva";
import { VC_NODE_KIND_ATTR, VC_ON_REMOVE_ATTR } from "../../core/CONSTANTS";
import { fnSortByPriority } from "../../core/fn.sort-by-priority";
import { isCanvasElementNode } from "../../core/GUARDS";
import type { TCanvasNodeKind, TNodeOnRemove } from "../../core/types";
import type { TCrdtBuilder } from "../crdt/fxBuilder";
import { fnMergeSelectionStyleMenuConfigs } from "./fn-merge-selection-style-menu-configs";
import type {
  TElementElementDefinition,
  TElementServiceHooks,
  TElementTransformOptions
} from "./types";
export * from "./types";

function callNodeOnRemove(node: Konva.Node) {
  const onRemove = node.getAttr(VC_ON_REMOVE_ATTR);
  if (typeof onRemove !== "function") {
    return;
  }

  (onRemove as TNodeOnRemove)({ node });
}

/**
 * Every element registers here
 * Responsibilities:
 * - map runtime nodes <-> persisted elements/groups
 * - create runtime nodes from persisted elements/groups
 * - run layered element lifecycle hooks in priority order
 * - keep group registration single-owner and stable
 *
 * Element lifecycle model:
 * - base serialize: toElement
 * - serialize modifiers: afterToElement
 * - base create: createNode
 * - create modifiers: afterCreateNode
 * - runtime wiring: attachListeners
 * - persisted replay: updateElement
 */
export class ElementService implements IService<TElementServiceHooks> {
  readonly name = "ElementService";
  readonly hooks: TElementServiceHooks = {
    elementsChange: new SyncHook<[]>,
  };

  readonly #elements: TElementElementDefinition[] = [];

  constructor() { }

  registerElement(definition: TElementElementDefinition) {
    this.#elements.push(definition);
    this.hooks.elementsChange.call();

    return () => {
      this.unregisterElement(definition.id);
    };
  }

  unregisterElement(id: string) {
    const index = this.#elements.findIndex((definition) => definition.id === id);
    if (index < 0) {
      return;
    }

    this.#elements.splice(index, 1);
    this.hooks.elementsChange.call();
  }

  private getElementDefinitions() {
    return fnSortByPriority(this.#elements);
  }

  /**
   * Returns all matching element definitions for one persisted element.
   * Results are ordered by ascending priority.
   */
  getMatchingElementDefinitionsByElement(element: TElement) {
    return this.getElementDefinitions().filter((definition) => definition.matchesElement?.(element) ?? false);
  }

  /**
   * Returns all matching element definitions for one runtime node.
   * Results are ordered by ascending priority.
   */
  getMatchingElementDefinitionsByNode(node: Konva.Node) {
    return this.getElementDefinitions().filter((definition) => definition.matchesNode?.(node) ?? false);
  }

  /**
   * Serializes one runtime node into one persisted element.
   * Uses the first matching base serializer, then runs all matching serialize modifiers.
   */
  toElement(node: Konva.Node) {
    const definitions = this.getMatchingElementDefinitionsByNode(node);
    const baseDefinition = definitions.find((definition) => definition.toElement);
    if (!baseDefinition?.toElement) {
      return null;
    }

    let element = baseDefinition.toElement(node);
    if (!element) {
      return null;
    }

    for (const definition of definitions) {
      const nextElement: TElement | void = definition.afterToElement?.({ node, element });
      if (nextElement) {
        element = nextElement;
      }
    }

    return element;
  }

  /**
   * Remove element
   */
  removeElement(node: unknown, builder: TCrdtBuilder) {
    if (!isCanvasElementNode(node)) return builder;

    return builder.deleteElement(node.id(), {
      onCommit: (args) => {
        for (const definition of this.getMatchingElementDefinitionsByElement(args.entity)) {
          definition.onDelete?.(args.entity);
        }
        callNodeOnRemove(node);
        node.destroy();
      },
      onRollback: (args) => {
        for (const definition of this.getMatchingElementDefinitionsByElement(args.entity)) {
          definition.onRestore?.(args.entity);
        }
      },
    });
  }

  /**
   * Resolves merged selection-style menu config for one persisted element.
   */
  getSelectionStyleMenuConfigByElement(args: {
    element: TElement;
    theme?: ThemeService;
  }) {
    return fnMergeSelectionStyleMenuConfigs(this.getMatchingElementDefinitionsByElement(args.element).map((definition) => {
      return definition.getSelectionStyleMenu?.({
        element: args.element,
        theme: args.theme,
      }) ?? null;
    }));
  }

  /**
   * Resolves merged selection-style menu config for one runtime node.
   */
  getSelectionStyleMenuConfigByNode(args: {
    node: Konva.Node;
    theme?: ThemeService;
  }) {
    const element = this.toElement(args.node);
    if (!element) {
      return null;
    }

    return this.getSelectionStyleMenuConfigByElement({
      element,
      theme: args.theme,
    });
  }

  /**
   * Resolves selection-style menu config for one registry definition id.
   * Useful for active-tool defaults when no element instance exists yet.
   */
  getSelectionStyleMenuConfigById(args: {
    id: string;
    theme?: ThemeService;
  }) {
    return fnMergeSelectionStyleMenuConfigs(this.getElementDefinitions()
      .filter((definition) => definition.id === args.id)
      .map((definition) => {
        return definition.getSelectionStyleMenu?.({
          theme: args.theme,
        }) ?? null;
      }));
  }

  /**
   * Creates one runtime node from one persisted element.
   * Uses the first matching base creator, then runs all matching create modifiers,
   * then runs all matching listener attachments.
   */
  createNodeFromElement(element: TElement) {
    const definitions = this.getMatchingElementDefinitionsByElement(element);
    const baseDefinition = definitions.find((definition) => definition.createNode);
    if (!baseDefinition?.createNode) {
      return null;
    }

    const node = baseDefinition.createNode(element);
    if (!node) {
      return null;
    }

    for (const definition of definitions) {
      definition.afterCreateNode?.({ element, node });
    }

    for (const definition of definitions) {
      definition.attachListeners?.(node);
    }

    node.setAttr(VC_NODE_KIND_ATTR, 'element' as TCanvasNodeKind);
    return node;
  }

  /**
   * Attaches runtime listeners to an existing node.
   * For groups this is single-owner.
   * For elements this runs all matching definitions in priority order.
   */
  attachListeners(node: Konva.Node) {
    const definitions = this.getMatchingElementDefinitionsByNode(node);
    if (definitions.length === 0) {
      return false;
    }

    let didAttach = false;
    for (const definition of definitions) {
      const result = definition.attachListeners?.(node);
      if (result !== undefined) {
        didAttach = Boolean(result) || didAttach;
      }
    }

    return didAttach;
  }

  /**
   * Starts clone-drag behavior for an existing runtime element.
   * Runs matching definition handlers in priority order until one handles it.
   */
  createDragClone(args: {
    node: Konva.Node;
    selection: Konva.Node[]
  }) {
    const definitions = this.getMatchingElementDefinitionsByNode(args.node);
    if (definitions.length === 0) {
      return false;
    }

    for (const definition of definitions) {
      const result = definition.createDragClone?.(args);
      if (result === true) {
        return true;
      }
    }

    return false;
  }

  /**
   * Replays one persisted element onto the runtime scene.
   * Runs all matching element update handlers in priority order.
   */
  updateElement(element: TElement) {
    const definitions = this.getMatchingElementDefinitionsByElement(element);
    if (definitions.length === 0) {
      return false;
    }

    let didUpdate = false;
    for (const definition of definitions) {
      const result = definition.updateElement?.(element);
      if (result !== undefined) {
        didUpdate = Boolean(result) || didUpdate;
      }
    }

    return didUpdate;
  }

  getTransformOptions(args: {
    node: Konva.Node;
    selection: Konva.Node[];
  }) {
    const element = this.toElement(args.node);
    if (!element) {
      return {} satisfies TElementTransformOptions;
    }

    const definitions = this.getMatchingElementDefinitionsByNode(args.node);
    let options: TElementTransformOptions = {};

    for (const definition of definitions) {
      const nextOptions = definition.getTransformOptions?.({
        node: args.node,
        element,
        selection: args.selection,
      });
      if (!nextOptions) {
        continue;
      }

      options = {
        ...options,
        ...nextOptions,
      };
    }

    return options;
  }
}
