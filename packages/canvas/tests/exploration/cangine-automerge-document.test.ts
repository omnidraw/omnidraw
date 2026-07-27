import * as Automerge from "@automerge/automerge";
import {
  createInfiniteCanvas,
  IDENTITY_TRANSFORM_2D,
  type IInfiniteCanvasEngine,
  type TJsonValue,
  type TLayerNode,
  type TRectNode,
  type TSceneJournalEntry,
  type TSceneNode,
  type TSceneSnapshot,
  type TSerializedSceneCommand,
} from "@omnidraw/cangine";
import {
  createStandardCanvasEditor,
  type IStandardCanvasEditor,
} from "@omnidraw/cangine/editor";
import {
  assertValidSceneSnapshot,
  ManualClock,
} from "@omnidraw/cangine/testing";
import type {
  TCanvasDoc,
  TElement,
  TElementData,
} from "@vibecanvas/service-automerge/types/canvas-doc.types";
import { getStroke } from "perfect-freehand";
import { afterEach, describe, expect, it } from "vitest";
import {
  createBuiltInProjectionRegistry,
} from "../../src/engine/projection/ProjectionRegistry";
import {
  fnCanvasEngineElementId,
} from "../../src/engine/projection/fn.ids";
import {
  fnProjectCanvasDocument,
} from "../../src/engine/projection/fn.project-document";
import type {
  TCanvasProjectionTheme,
} from "../../src/engine/typed";
import {
  createTestContainer,
  ensureDom,
  ensureRangeGeometryMocks,
  ensureResizeObserver,
} from "../test-setup";
import { CanvasEngineTestFactory } from "../engine/engine-test-backend";

type TCanvasAssetReference = {
  kind: "image";
  source: {
    kind: "url";
    value: string;
  };
};

type TCollaborativeCanvasDocument = {
  schemaVersion: 2;
  cangineSchemaVersion: "1.0.0";
  rootLayerIds: string[];
  nodes: Record<string, TSceneNode>;
  assets: Record<string, TCanvasAssetReference>;
};

type TWidgetInstanceProjectionRecord = {
  nodeId: string;
  definitionId: string;
  revisionId: string;
  instanceId: string;
  stateDocumentId: string | null;
};

type TLeafMutation = {
  path: (string | number)[];
  beforeExists: boolean;
  before: unknown;
  afterExists: boolean;
  after: unknown;
};

type THistoryNodeUpdate = {
  nodeId: string;
  mutations: TLeafMutation[];
};

type THistoryItem = {
  added: TSceneNode[];
  removed: TSceneNode[];
  updated: THistoryNodeUpdate[];
};

const ACTOR_A = "00000000000000000000000000000001";
const ACTOR_B = "00000000000000000000000000000002";
const WIDGET_EXTENSION = "vibecanvas:widget";
const AUTHORING_EXTENSION = "vibecanvas:authoring";

const THEME: TCanvasProjectionTheme = {
  id: "e39-migration-theme",
  colors: {
    accent: "#dbeafe",
    accentForeground: "#1e3a8a",
    border: "#d6d3d1",
    canvasBackground: "rgba(168, 162, 158, 0.10)",
    canvasGridMajor: "rgba(71, 85, 105, 0.28)",
    canvasGridMinor: "rgba(71, 85, 105, 0.16)",
    canvasSelectionStroke: "#3b82f6",
    canvasText: "#111827",
    card: "#ffffff",
    destructive: "#dc2626",
    muted: "#e7e5e4",
    mutedForeground: "#57534e",
    ring: "#f59e0b",
    success: "#16a34a",
    warning: "#d97706",
  },
  colorTokens: {
    "@base/100": "#f5f5f4",
    "@base/300": "#d6d3d1",
    "@base/900": "#1c1917",
    "@blue/700": "#1d4ed8",
    "@transparent": "transparent",
  },
};

function clone<T>(value: T): T {
  if (value === undefined) {
    return value;
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object"
    && value !== null
    && !Array.isArray(value);
}

function jsonEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function layer(): TLayerNode {
  return {
    id: "content",
    parentId: null,
    orderKey: "A",
    kind: "layer",
    role: "content",
    coordinateSpace: "world",
    transform: IDENTITY_TRANSFORM_2D,
  };
}

function rect(
  id = "rect",
  x = 0,
  orderKey = "A",
): TRectNode {
  return {
    id,
    parentId: "content",
    orderKey,
    kind: "rect",
    transform: {
      ...IDENTITY_TRANSFORM_2D,
      position: { x, y: 0 },
    },
    size: { width: 120, height: 80 },
    fill: {
      type: "solid",
      color: { space: "srgb", r: 0.2, g: 0.3, b: 0.4, a: 1 },
    },
  };
}

function group(
  id: string,
  parentId: string,
  orderKey: string,
): TSceneNode {
  return {
    id,
    parentId,
    orderKey,
    kind: "group",
    transform: IDENTITY_TRANSFORM_2D,
  };
}

function initialDocument(
  nodes: readonly TSceneNode[] = [layer(), rect()],
): TCollaborativeCanvasDocument {
  return {
    schemaVersion: 2,
    cangineSchemaVersion: "1.0.0",
    rootLayerIds: ["content"],
    nodes: Object.fromEntries(nodes.map((node) => [node.id, clone(node)])),
    assets: {},
  };
}

function nodeDepth(
  nodes: Readonly<Record<string, TSceneNode>>,
  nodeId: string,
): number {
  const visited = new Set<string>();
  let current = nodes[nodeId];
  let depth = 0;
  while (current?.parentId !== null && current?.parentId !== undefined) {
    if (visited.has(current.id)) {
      return Number.MAX_SAFE_INTEGER;
    }
    visited.add(current.id);
    depth += 1;
    current = nodes[current.parentId];
  }
  return depth;
}

function orderedNodes(
  document: TCollaborativeCanvasDocument,
): TSceneNode[] {
  for (const [key, node] of Object.entries(document.nodes)) {
    if (key !== node.id) {
      throw new TypeError(
        `Collaborative scene node key '${key}' does not match '${node.id}'.`,
      );
    }
  }

  const rootOrder = new Map(
    document.rootLayerIds.map((id, index) => [id, index]),
  );
  return Object.values(document.nodes)
    .map(clone)
    .sort((left, right) => {
      const leftRoot = rootOrder.get(left.id);
      const rightRoot = rootOrder.get(right.id);
      if (leftRoot !== undefined || rightRoot !== undefined) {
        if (leftRoot !== undefined && rightRoot !== undefined) {
          return leftRoot - rightRoot;
        }
        return leftRoot !== undefined ? -1 : 1;
      }
      return nodeDepth(document.nodes, left.id)
        - nodeDepth(document.nodes, right.id)
        || (left.parentId ?? "").localeCompare(right.parentId ?? "")
        || left.orderKey.localeCompare(right.orderKey)
        || left.id.localeCompare(right.id);
    });
}

function materializeSnapshot(
  document: TCollaborativeCanvasDocument,
): TSceneSnapshot {
  const snapshot: TSceneSnapshot = {
    schemaVersion: document.cangineSchemaVersion,
    rootLayerIds: [...document.rootLayerIds],
    nodes: orderedNodes(document),
  };
  assertValidSceneSnapshot(snapshot);
  return snapshot;
}

function reconcileObject(
  target: Record<string, unknown>,
  value: Record<string, unknown>,
): void {
  for (const key of Object.keys(target)) {
    if (!(key in value)) {
      delete target[key];
    }
  }
  for (const [key, next] of Object.entries(value)) {
    const current = target[key];
    if (isRecord(current) && isRecord(next)) {
      reconcileObject(current, next);
      continue;
    }
    if (!jsonEqual(current, next)) {
      target[key] = clone(next);
    }
  }
}

function descendantIds(
  nodes: Readonly<Record<string, TSceneNode>>,
  nodeId: string,
): string[] {
  const found: string[] = [];
  const pending = [nodeId];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const parentId = pending.pop()!;
    if (visited.has(parentId)) {
      continue;
    }
    visited.add(parentId);
    for (const node of Object.values(nodes)) {
      if (node.parentId !== parentId) {
        continue;
      }
      found.push(node.id);
      pending.push(node.id);
    }
  }
  return found;
}

function applySceneCommandsToAutomerge(
  document: TCollaborativeCanvasDocument,
  commands: readonly TSerializedSceneCommand[],
): void {
  for (const command of commands) {
    if (command.type === "replace-snapshot") {
      document.rootLayerIds.splice(
        0,
        document.rootLayerIds.length,
        ...command.snapshot.rootLayerIds,
      );
      const nextNodes = Object.fromEntries(
        command.snapshot.nodes.map((node) => [node.id, clone(node)]),
      );
      reconcileObject(
        document.nodes as unknown as Record<string, unknown>,
        nextNodes,
      );
      continue;
    }
    if (command.type === "upsert") {
      const current = document.nodes[command.node.id];
      if (current === undefined) {
        document.nodes[command.node.id] = clone(command.node);
      } else {
        reconcileObject(
          current as unknown as Record<string, unknown>,
          command.node as unknown as Record<string, unknown>,
        );
      }
      continue;
    }
    if (command.type === "remove") {
      if (command.descendants === "reparent") {
        const removed = document.nodes[command.nodeId];
        for (const node of Object.values(document.nodes)) {
          if (node.parentId === command.nodeId) {
            node.parentId = removed?.parentId ?? null;
          }
        }
      } else {
        for (const id of descendantIds(document.nodes, command.nodeId)) {
          delete document.nodes[id];
        }
      }
      delete document.nodes[command.nodeId];
      continue;
    }
    const node = document.nodes[command.nodeId];
    if (node === undefined) {
      continue;
    }
    if (command.type === "reorder") {
      node.orderKey = command.orderKey;
      continue;
    }
    node.parentId = command.parentId;
    if (command.orderKey !== undefined) {
      node.orderKey = command.orderKey;
    }
  }
}

function changedNodeIds(patches: readonly Automerge.Patch[]): string[] {
  return [...new Set(patches.flatMap((patch) => {
    const [root, nodeId] = patch.path;
    return root === "nodes" && typeof nodeId === "string"
      ? [nodeId]
      : [];
  }))].sort();
}

function commandsFromAutomergePatches(
  patches: readonly Automerge.Patch[],
  before: Automerge.Doc<TCollaborativeCanvasDocument>,
  after: Automerge.Doc<TCollaborativeCanvasDocument>,
): TSerializedSceneCommand[] {
  const changedIds = changedNodeIds(patches);
  const rootChanged = patches.some((patch) => {
    return patch.path[0] === "rootLayerIds"
      || patch.path[0] === "cangineSchemaVersion"
      || (patch.path[0] === "nodes" && patch.path.length === 1);
  });
  if (rootChanged) {
    return [{
      type: "replace-snapshot",
      snapshot: materializeSnapshot(
        after as unknown as TCollaborativeCanvasDocument,
      ),
    }];
  }

  const removed = changedIds
    .filter((id) => before.nodes[id] !== undefined && after.nodes[id] === undefined)
    .sort((left, right) => {
      return nodeDepth(before.nodes, left) - nodeDepth(before.nodes, right)
        || left.localeCompare(right);
    })
    .filter((id, _index, ids) => {
      let parentId = before.nodes[id]?.parentId ?? null;
      while (parentId !== null) {
        if (ids.includes(parentId)) {
          return false;
        }
        parentId = before.nodes[parentId]?.parentId ?? null;
      }
      return true;
    })
    .map<TSerializedSceneCommand>((nodeId) => ({
      type: "remove",
      nodeId,
      descendants: "remove",
    }));
  const upserts = changedIds
    .flatMap((id) => {
      const node = after.nodes[id];
      return node === undefined ? [] : [clone(node)];
    })
    .sort((left, right) => {
      return nodeDepth(after.nodes, left.id) - nodeDepth(after.nodes, right.id)
        || left.id.localeCompare(right.id);
    })
    .map<TSerializedSceneCommand>((node) => ({
      type: "upsert",
      node,
    }));
  return [...removed, ...upserts];
}

function diffLeaves(
  before: unknown,
  after: unknown,
  path: (string | number)[] = [],
): TLeafMutation[] {
  if (jsonEqual(before, after)) {
    return [];
  }
  if (
    isRecord(before)
    && isRecord(after)
  ) {
    return [...new Set([
      ...Object.keys(before),
      ...Object.keys(after),
    ])].sort().flatMap((key) => {
      const beforeExists = key in before;
      const afterExists = key in after;
      if (!beforeExists || !afterExists) {
        return [{
          path: [...path, key],
          beforeExists,
          before: clone(before[key]),
          afterExists,
          after: clone(after[key]),
        }];
      }
      return diffLeaves(before[key], after[key], [...path, key]);
    });
  }
  return [{
    path,
    beforeExists: true,
    before: clone(before),
    afterExists: true,
    after: clone(after),
  }];
}

function getAtPath(
  value: unknown,
  path: readonly (string | number)[],
): { exists: boolean; value: unknown } {
  let current = value;
  for (const key of path) {
    if (!isRecord(current) && !Array.isArray(current)) {
      return { exists: false, value: undefined };
    }
    if (!(key in current)) {
      return { exists: false, value: undefined };
    }
    current = current[key as never];
  }
  return { exists: true, value: current };
}

function setAtPath(
  target: Record<string, unknown>,
  path: readonly (string | number)[],
  exists: boolean,
  value: unknown,
): void {
  const key = path[path.length - 1];
  if (key === undefined) {
    return;
  }
  let parent: Record<string | number, unknown> = target;
  for (const segment of path.slice(0, -1)) {
    const current = parent[segment];
    if (!isRecord(current) && !Array.isArray(current)) {
      parent[segment] = {};
    }
    parent = parent[segment] as Record<string | number, unknown>;
  }
  if (!exists) {
    delete parent[key];
  } else {
    parent[key] = clone(value);
  }
}

function createHistoryItem(
  entry: TSceneJournalEntry,
  scene: IInfiniteCanvasEngine["scene"],
): THistoryItem {
  const added = entry.change.added.flatMap((id) => {
    const node = scene.get(id);
    return node === null ? [] : [clone(node)];
  });
  const removed = entry.change.removed.flatMap((id) => {
    const node = entry.before[id];
    return node === null || node === undefined ? [] : [clone(node)];
  });
  const updatedIds = [...new Set([
    ...entry.change.updated,
    ...entry.change.reparented,
    ...entry.change.reordered,
  ])];
  const updated = updatedIds.flatMap((nodeId) => {
    const before = entry.before[nodeId];
    const after = scene.get(nodeId);
    if (before === null || before === undefined || after === null) {
      return [];
    }
    const mutations = diffLeaves(before, after);
    return mutations.length === 0 ? [] : [{ nodeId, mutations }];
  });
  return { added, removed, updated };
}

function rootIds(
  nodes: readonly TSceneNode[],
): string[] {
  const ids = new Set(nodes.map((node) => node.id));
  return nodes
    .filter((node) => node.parentId === null || !ids.has(node.parentId))
    .map((node) => node.id);
}

function historyCommands(
  item: THistoryItem,
  scene: IInfiniteCanvasEngine["scene"],
  direction: "undo" | "redo",
  conflicts: string[],
): TSerializedSceneCommand[] {
  const removeNodes = direction === "undo" ? item.added : item.removed;
  const restoreNodes = direction === "undo" ? item.removed : item.added;
  const removals = rootIds(removeNodes).map<TSerializedSceneCommand>((nodeId) => ({
    type: "remove",
    nodeId,
    descendants: "remove",
  }));
  const restores = [...restoreNodes]
    .sort((left, right) => {
      const ids = Object.fromEntries(
        restoreNodes.map((node) => [node.id, node]),
      );
      return nodeDepth(ids, left.id) - nodeDepth(ids, right.id)
        || left.id.localeCompare(right.id);
    })
    .map<TSerializedSceneCommand>((node) => ({
      type: "upsert",
      node: clone(node),
    }));
  const updates = item.updated.flatMap((update) => {
    const current = scene.get(update.nodeId);
    if (current === null) {
      conflicts.push(`${update.nodeId}:missing`);
      return [];
    }
    const next = clone(current) as unknown as Record<string, unknown>;
    let changed = false;
    for (const mutation of update.mutations) {
      const expectedExists = direction === "undo"
        ? mutation.afterExists
        : mutation.beforeExists;
      const expected = direction === "undo"
        ? mutation.after
        : mutation.before;
      const replacementExists = direction === "undo"
        ? mutation.beforeExists
        : mutation.afterExists;
      const replacement = direction === "undo"
        ? mutation.before
        : mutation.after;
      const actual = getAtPath(next, mutation.path);
      if (
        actual.exists !== expectedExists
        || !jsonEqual(actual.value, expected)
      ) {
        conflicts.push(`${update.nodeId}:${mutation.path.join(".")}`);
        continue;
      }
      setAtPath(next, mutation.path, replacementExists, replacement);
      changed = true;
    }
    return changed
      ? [{
          type: "upsert" as const,
          node: next as unknown as TSceneNode,
        }]
      : [];
  });
  return [...removals, ...restores, ...updates];
}

class CollaborativeScenePeer {
  readonly host: HTMLDivElement;
  readonly engine: IInfiniteCanvasEngine;
  readonly actor: string;
  readonly localPatchBatches: Automerge.Patch[][] = [];
  readonly remoteCommandBatches: TSerializedSceneCommand[][] = [];
  readonly historyConflicts: string[] = [];
  readonly errors: unknown[] = [];

  document: Automerge.Doc<TCollaborativeCanvasDocument>;
  #unsubscribe: (() => void) | null = null;
  #undo: THistoryItem[] = [];
  #redo: THistoryItem[] = [];

  private constructor(args: {
    actor: string;
    document: Automerge.Doc<TCollaborativeCanvasDocument>;
    host: HTMLDivElement;
    engine: IInfiniteCanvasEngine;
  }) {
    this.actor = args.actor;
    this.document = args.document;
    this.host = args.host;
    this.engine = args.engine;
  }

  static async create(args: {
    actor: string;
    document: Automerge.Doc<TCollaborativeCanvasDocument>;
  }): Promise<CollaborativeScenePeer> {
    ensureDom();
    ensureResizeObserver();
    ensureRangeGeometryMocks();
    const host = createTestContainer({ width: 800, height: 600 });
    const engine = await createInfiniteCanvas({
      host,
      renderProfile: {
        vector2D: "webgl2",
        threeD: "disabled",
        portals: "disabled",
      },
      backendFactories: [new CanvasEngineTestFactory()],
      clock: new ManualClock(),
      record: { actor: args.actor },
    });
    engine.scene.replace(
      materializeSnapshot(
        args.document as unknown as TCollaborativeCanvasDocument,
      ),
      { source: "bridge:hydrate" },
    );
    const peer = new CollaborativeScenePeer({
      actor: args.actor,
      document: args.document,
      host,
      engine,
    });
    peer.#unsubscribe = engine.recorder!.subscribe((entry) => {
      peer.#captureLocalSceneEntry(entry);
    });
    return peer;
  }

  changeScene(
    callback: Parameters<IInfiniteCanvasEngine["scene"]["transaction"]>[0],
    source: string,
  ): void {
    this.engine.scene.transaction(callback, { source });
  }

  changeDocument(
    callback: (document: TCollaborativeCanvasDocument) => void,
  ): void {
    this.document = Automerge.change(
      this.document,
      { message: `direct:${this.actor}` },
      callback,
    );
  }

  receive(remote: CollaborativeScenePeer): {
    patches: number;
    commands: number;
  } {
    let patches: Automerge.Patch[] = [];
    let before: Automerge.Doc<TCollaborativeCanvasDocument> | null = null;
    let after: Automerge.Doc<TCollaborativeCanvasDocument> | null = null;
    [this.document] = Automerge.applyChanges(
      this.document,
      Automerge.getAllChanges(remote.document),
      {
        patchCallback(nextPatches, info) {
          patches = nextPatches;
          before = info.before;
          after = info.after;
        },
      },
    );
    if (patches.length === 0 || before === null || after === null) {
      return { patches: 0, commands: 0 };
    }
    const commands = commandsFromAutomergePatches(patches, before, after);
    this.remoteCommandBatches.push(commands);
    if (commands.length > 0) {
      try {
        this.engine.scene.apply(commands, {
          source: `bridge:remote:${remote.actor}`,
        });
      } catch (error) {
        this.errors.push(error);
      }
    }
    return { patches: patches.length, commands: commands.length };
  }

  undo(): boolean {
    const item = this.#undo.pop();
    if (item === undefined) {
      return false;
    }
    const commands = historyCommands(
      item,
      this.engine.scene,
      "undo",
      this.historyConflicts,
    );
    if (commands.length > 0) {
      this.engine.scene.apply(commands, { source: "bridge:undo" });
    }
    this.#redo.push(item);
    return true;
  }

  redo(): boolean {
    const item = this.#redo.pop();
    if (item === undefined) {
      return false;
    }
    const commands = historyCommands(
      item,
      this.engine.scene,
      "redo",
      this.historyConflicts,
    );
    if (commands.length > 0) {
      this.engine.scene.apply(commands, { source: "bridge:redo" });
    }
    this.#undo.push(item);
    return true;
  }

  async destroy(): Promise<void> {
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    await this.engine.destroy();
    this.host.remove();
  }

  #captureLocalSceneEntry(entry: TSceneJournalEntry): void {
    const source = entry.meta.source ?? "";
    if (source.startsWith("bridge:remote") || source === "bridge:hydrate") {
      return;
    }
    if (source !== "bridge:undo" && source !== "bridge:redo") {
      this.#undo.push(createHistoryItem(entry, this.engine.scene));
      this.#redo = [];
    }
    let patches: Automerge.Patch[] = [];
    this.document = Automerge.change(
      this.document,
      {
        message: `cangine:${this.actor}:${entry.seq}`,
        patchCallback(nextPatches) {
          patches = nextPatches;
        },
      },
      (document) => {
        applySceneCommandsToAutomerge(document, entry.commands);
      },
    );
    this.localPatchBatches.push(patches);
  }
}

function widgetExtension(
  element: TElement,
): TJsonValue | null {
  const data = element.data;
  if (data.type === "ui-widget") {
    return {
      type: "ui-widget",
      kind: data.kind,
      ...(data.payload === undefined
        ? {}
        : { payload: clone(data.payload) as unknown as TJsonValue }),
      ...(data.uiProps === undefined
        ? {}
        : { uiProps: clone(data.uiProps) as unknown as TJsonValue }),
    };
  }
  if (data.type === "widget-instance") {
    return {
      type: "widget-instance",
      definitionId: data.definitionId,
      revisionId: data.revisionId,
      instanceId: data.instanceId,
      ...(data.stateDocumentId === undefined
        ? {}
        : { stateDocumentId: data.stateDocumentId }),
      ...(data.uiProps === undefined
        ? {}
        : { uiProps: clone(data.uiProps) as unknown as TJsonValue }),
    };
  }
  return null;
}

function authoringExtension(
  element: TElement,
): TJsonValue {
  return {
    locked: element.locked,
    createdAt: element.createdAt,
    updatedAt: element.updatedAt,
    ...(element.data.type === "pen"
      ? {
          penSource: {
            points: clone(element.data.points),
            pressures: clone(element.data.pressures),
            simulatePressure: element.data.simulatePressure,
          },
        }
      : {}),
    ...(Object.keys(element.style).length === 0
      ? {}
      : { legacyStyleTokens: clone(element.style) }),
  };
}

function migrateLegacyDocument(
  document: TCanvasDoc,
): TCollaborativeCanvasDocument {
  const projection = fnProjectCanvasDocument({
    document,
    registry: createBuiltInProjectionRegistry(),
    theme: THEME,
    dependencies: {
      getStroke,
      portalsAvailable: true,
    },
  });
  const assets: Record<string, TCanvasAssetReference> = {};
  const nodes = projection.snapshot.nodes.map((sourceNode) => {
    const node = clone(sourceNode);
    const elementId = typeof node.metadata?.["vibecanvas:element-id"] === "string"
      ? node.metadata["vibecanvas:element-id"]
      : null;
    if (elementId === null) {
      return node;
    }
    const element = document.elements[elementId];
    if (element === undefined) {
      return node;
    }
    const extension: Record<string, TJsonValue> = {
      ...node.extensions,
      [AUTHORING_EXTENSION]: authoringExtension(element),
    };
    const widget = widgetExtension(element);
    if (widget !== null && node.kind === "widget-frame") {
      extension[WIDGET_EXTENSION] = widget;
    }
    node.extensions = extension;
    if (node.kind === "connector") {
      const data = element.data;
      if (data.type === "line" || data.type === "arrow") {
        if (data.startBinding !== null) {
          node.from = {
            type: "node",
            nodeId: fnCanvasEngineElementId({
              id: data.startBinding.targetId,
            }),
            anchor: "auto",
          };
        }
        if (data.endBinding !== null) {
          node.to = {
            type: "node",
            nodeId: fnCanvasEngineElementId({
              id: data.endBinding.targetId,
            }),
            anchor: "auto",
          };
        }
      }
    }
    if (node.kind === "image" && element.data.type === "image") {
      const source = element.data.url ?? element.data.base64;
      if (source !== null) {
        assets[node.resourceId] = {
          kind: "image",
          source: { kind: "url", value: source },
        };
      }
    }
    return node;
  });
  return {
    schemaVersion: 2,
    cangineSchemaVersion: "1.0.0",
    rootLayerIds: [...projection.snapshot.rootLayerIds],
    nodes: Object.fromEntries(nodes.map((node) => [node.id, node])),
    assets,
  };
}

function requiredUuid(value: unknown, label: string): string {
  if (
    typeof value !== "string"
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)
  ) {
    throw new TypeError(`${label} must be a lowercase UUID.`);
  }
  return value;
}

function extractWidgetInstances(
  document: TCollaborativeCanvasDocument,
): TWidgetInstanceProjectionRecord[] {
  const instanceIds = new Set<string>();
  return Object.values(document.nodes)
    .flatMap((node) => {
      const value = node.extensions?.[WIDGET_EXTENSION];
      if (!isRecord(value) || value.type !== "widget-instance") {
        return [];
      }
      const instanceId = requiredUuid(value.instanceId, "Widget instance id");
      if (instanceIds.has(instanceId)) {
        throw new TypeError(
          `Widget instance id '${instanceId}' appears more than once.`,
        );
      }
      instanceIds.add(instanceId);
      return [{
        nodeId: node.id,
        definitionId: requiredUuid(
          value.definitionId,
          "Widget definition id",
        ),
        revisionId: requiredUuid(value.revisionId, "Widget revision id"),
        instanceId,
        stateDocumentId: typeof value.stateDocumentId === "string"
          ? value.stateDocumentId
          : null,
      }];
    })
    .sort((left, right) => left.nodeId.localeCompare(right.nodeId));
}

function baseElement(
  id: string,
  data: TElementData,
  index: number,
): TElement {
  return {
    id,
    x: index * 20,
    y: index * 10,
    rotation: index * 10,
    scaleX: 1,
    scaleY: 1,
    zIndex: `z${String(index).padStart(4, "0")}`,
    parentGroupId: "group",
    bindings: [],
    locked: index % 2 === 0,
    createdAt: 1_700_000_000_000 + index,
    updatedAt: 1_700_000_001_000 + index,
    data,
    style: {},
  };
}

function representativeLegacyDocument(): TCanvasDoc {
  const inlineText = {
    type: "text" as const,
    w: 120,
    h: 60,
    text: "Inline",
    originalText: "Inline",
    fontFamily: "Inter",
    link: null,
    containerId: "rect",
    autoResize: false,
  };
  const data = {
    rect: {
      type: "rect",
      w: 120,
      h: 60,
      radius: 8,
      text: inlineText,
    },
    ellipse: {
      type: "ellipse",
      rx: 60,
      ry: 30,
      text: { ...inlineText, containerId: "ellipse" },
    },
    diamond: {
      type: "diamond",
      w: 120,
      h: 80,
      text: { ...inlineText, containerId: "diamond" },
    },
    arrow: {
      type: "arrow",
      lineType: "curved",
      points: [[0, 0], [40, 20], [100, 0]],
      startBinding: {
        targetId: "rect",
        anchor: { x: 1, y: 0.5 },
      },
      endBinding: {
        targetId: "diamond",
        anchor: { x: 0, y: 0.5 },
      },
      startCap: "dot",
      endCap: "arrow",
    },
    line: {
      type: "line",
      lineType: "straight",
      points: [[0, 0], [100, 50]],
      startBinding: null,
      endBinding: null,
    },
    pen: {
      type: "pen",
      points: [[0, 0], [10, 4], [20, -2]],
      pressures: [0.2, 0.7, 0.4],
      simulatePressure: false,
    },
    text: {
      ...inlineText,
      containerId: null,
      autoResize: true,
    },
    image: {
      type: "image",
      url: "https://example.invalid/image.png",
      base64: null,
      w: 320,
      h: 180,
      crop: {
        x: 0,
        y: 0,
        width: 320,
        height: 180,
        naturalWidth: 640,
        naturalHeight: 360,
      },
    },
    "ui-widget": {
      type: "ui-widget",
      kind: "counter",
      w: 480,
      h: 320,
      expanded: true,
      payload: { count: 2 },
      uiProps: { accent: "blue" },
    },
    "widget-instance": {
      type: "widget-instance",
      definitionId: "11111111-1111-4111-8111-111111111111",
      revisionId: "22222222-2222-4222-8222-222222222222",
      instanceId: "33333333-3333-4333-8333-333333333333",
      stateDocumentId: "automerge:4P9w8qKtNvbzkexUwmBRETTKQgLf",
      uiProps: { accent: "amber" },
      w: 640,
      h: 400,
      expanded: false,
    },
  } satisfies Record<string, TElementData>;
  return {
    id: "legacy-document",
    name: "Legacy document",
    elements: Object.fromEntries(
      Object.entries(data).map(([id, elementData], index) => [
        id,
        baseElement(id, elementData, index + 1),
      ]),
    ),
    groups: {
      group: {
        id: "group",
        parentGroupId: null,
        zIndex: "z0000",
        locked: false,
        createdAt: 1_700_000_000_000,
      },
      nested: {
        id: "nested",
        parentGroupId: "group",
        zIndex: "z0001",
        locked: false,
        createdAt: 1_700_000_000_001,
      },
    },
  };
}

describe("E39 Automerge-normalized Cangine document hypothesis", () => {
  const peers: CollaborativeScenePeer[] = [];
  const editors: IStandardCanvasEditor[] = [];

  afterEach(async () => {
    for (const editor of editors.splice(0).reverse()) {
      editor.destroy();
    }
    await Promise.all(peers.splice(0).map((peer) => peer.destroy()));
  });

  async function createPeerPair(
    value: TCollaborativeCanvasDocument = initialDocument(),
  ): Promise<[CollaborativeScenePeer, CollaborativeScenePeer]> {
    const base = Automerge.from(value, { actor: ACTOR_A });
    const left = await CollaborativeScenePeer.create({
      actor: ACTOR_A,
      document: base,
    });
    const right = await CollaborativeScenePeer.create({
      actor: ACTOR_B,
      document: Automerge.clone(base, { actor: ACTOR_B }),
    });
    peers.push(left, right);
    return [left, right];
  }

  it("converges disjoint same-node edits and one atomic multi-node transaction without local echo", async () => {
    const [left, right] = await createPeerPair();
    const leftRevision = left.engine.scene.revision;
    left.changeScene((transaction) => {
      transaction.update("rect", (node) => ({
        ...node,
        transform: {
          ...node.transform,
          position: { x: 80, y: 0 },
        },
      }));
      transaction.upsert({
        ...rect("second", 160, "B"),
        size: { width: 60, height: 40 },
      });
    }, "test:left-move-and-add");
    right.changeScene((transaction) => {
      transaction.update("rect", (node) => ({
        ...node,
        opacity: 0.5,
      }));
    }, "test:right-opacity");

    expect(left.engine.scene.revision).toBe(leftRevision + 1);
    const localPatches = left.localPatchBatches.at(-1) ?? [];
    expect(changedNodeIds(localPatches)).toEqual(["rect", "second"]);
    expect(localPatches).toContainEqual(expect.objectContaining({
      path: ["nodes", "rect", "transform", "position", "x"],
    }));

    const rightRevision = right.engine.scene.revision;
    const rightReceive = right.receive(left);
    expect(rightReceive.commands).toBe(2);
    expect(right.engine.scene.revision).toBe(rightRevision + 1);
    left.receive(right);

    expect(left.document.nodes.rect.transform.position.x).toBe(80);
    expect(left.document.nodes.rect.opacity).toBe(0.5);
    expect(right.document.nodes.rect.transform.position.x).toBe(80);
    expect(right.document.nodes.rect.opacity).toBe(0.5);
    expect(left.engine.scene.snapshot()).toEqual(right.engine.scene.snapshot());
    expect(left.engine.scene.get("second")).not.toBeNull();
    expect(left.errors).toEqual([]);
    expect(right.errors).toEqual([]);
  });

  it("propagates hierarchy and order changes as one remote Cangine transaction", async () => {
    const [left, right] = await createPeerPair(
      initialDocument([layer(), rect(), rect("second", 160, "B")]),
    );
    const beforeRevision = right.engine.scene.revision;

    left.changeScene((transaction) => {
      transaction.upsert(group("group", "content", "A"));
      transaction.reparent("rect", "group", { orderKey: "A" });
      transaction.reorder("second", "0");
    }, "test:hierarchy-and-order");

    expect(changedNodeIds(left.localPatchBatches.at(-1) ?? [])).toEqual([
      "group",
      "rect",
      "second",
    ]);
    const result = right.receive(left);
    expect(result.commands).toBe(3);
    expect(right.engine.scene.revision).toBe(beforeRevision + 1);
    expect(right.engine.scene.get("rect")?.parentId).toBe("group");
    expect(right.engine.scene.get("rect")?.orderKey).toBe("A");
    expect(right.engine.scene.get("second")?.orderKey).toBe("0");
  });

  it("exposes deterministic same-field conflicts and delete-wins over a concurrent nested update", async () => {
    const [left, right] = await createPeerPair();
    left.changeScene((transaction) => {
      transaction.update("rect", (node) => ({ ...node, opacity: 0.2 }));
    }, "test:left-opacity");
    right.changeScene((transaction) => {
      transaction.update("rect", (node) => ({ ...node, opacity: 0.7 }));
    }, "test:right-opacity");
    expect(left.engine.scene.get("rect")?.opacity).toBe(0.2);
    expect(right.engine.scene.get("rect")?.opacity).toBe(0.7);
    expect(
      Automerge.getConflicts(
        left.document.nodes.rect as unknown as Automerge.Doc<{
          opacity?: number;
        }>,
        "opacity",
      ),
    ).toBeUndefined();
    expect(left.localPatchBatches.at(-1)).toContainEqual(
      expect.objectContaining({ path: ["nodes", "rect", "opacity"] }),
    );
    expect(right.localPatchBatches.at(-1)).toContainEqual(
      expect.objectContaining({ path: ["nodes", "rect", "opacity"] }),
    );
    expect(left.document.nodes.rect.opacity).toBe(0.2);
    expect(right.document.nodes.rect.opacity).toBe(0.7);
    left.receive(right);
    const conflictsAfterFirstMerge = Automerge.getConflicts(
      left.document.nodes.rect as unknown as Automerge.Doc<{
        opacity?: number;
      }>,
      "opacity",
    );
    right.receive(left);

    expect(Object.values(conflictsAfterFirstMerge ?? {}).sort()).toEqual([
      0.2,
      0.7,
    ]);
    expect(left.document.nodes.rect.opacity).toBe(
      right.document.nodes.rect.opacity,
    );

    const merged = Automerge.clone(left.document, {
      actor: "00000000000000000000000000000003",
    });
    const deleting = await CollaborativeScenePeer.create({
      actor: "00000000000000000000000000000003",
      document: merged,
    });
    const updating = await CollaborativeScenePeer.create({
      actor: "00000000000000000000000000000004",
      document: Automerge.clone(merged, {
        actor: "00000000000000000000000000000004",
      }),
    });
    peers.push(deleting, updating);
    deleting.changeScene((transaction) => {
      transaction.remove("rect", { descendants: "remove" });
    }, "test:delete");
    updating.changeScene((transaction) => {
      transaction.update("rect", (node) => ({
        ...node,
        transform: {
          ...node.transform,
          position: { x: 99, y: 0 },
        },
      }));
    }, "test:update");
    deleting.receive(updating);
    updating.receive(deleting);

    expect(deleting.document.nodes.rect).toBeUndefined();
    expect(updating.document.nodes.rect).toBeUndefined();
    expect(deleting.engine.scene.get("rect")).toBeNull();
    expect(updating.engine.scene.get("rect")).toBeNull();
  });

  it("keeps the last-good Cangine scene when a merged document violates hierarchy invariants", async () => {
    const [left, right] = await createPeerPair();
    const before = right.engine.scene.snapshot();
    left.changeDocument((document) => {
      document.nodes.rect.parentId = "missing-parent";
    });

    const result = right.receive(left);
    expect(result.commands).toBe(1);
    expect(right.document.nodes.rect.parentId).toBe("missing-parent");
    expect(right.errors).toHaveLength(1);
    expect(right.engine.scene.snapshot()).toEqual(before);

    left.changeDocument((document) => {
      document.nodes.rect.parentId = "content";
    });
    right.receive(left);
    expect(right.engine.scene.get("rect")?.parentId).toBe("content");
  });

  it("uses Cangine editor commands and collaborative compensating history without clobbering an unrelated remote field", async () => {
    const [left, right] = await createPeerPair();
    left.changeScene((transaction) => {
      transaction.update("rect", (node) => ({
        ...node,
        transform: {
          ...node.transform,
          position: { x: 50, y: 0 },
        },
      }));
    }, "test:local-transform");
    right.changeScene((transaction) => {
      transaction.update("rect", (node) => ({ ...node, opacity: 0.4 }));
    }, "test:remote-style");
    left.receive(right);
    right.receive(left);

    expect(left.document.nodes.rect.opacity).toBe(0.4);
    expect(right.document.nodes.rect.opacity).toBe(0.4);
    expect(left.undo()).toBe(true);
    right.receive(left);
    expect(left.document.nodes.rect.transform.position.x).toBe(0);
    expect(right.document.nodes.rect.transform.position.x).toBe(0);
    expect(left.document.nodes.rect.opacity).toBe(0.4);
    expect(right.document.nodes.rect.opacity).toBe(0.4);
    expect(left.historyConflicts).toEqual([]);

    expect(left.redo()).toBe(true);
    right.receive(left);
    expect(right.document.nodes.rect.transform.position.x).toBe(50);
    expect(right.document.nodes.rect.opacity).toBe(0.4);

    const editor = createStandardCanvasEditor({
      engine: left.engine,
      contentParentId: "content",
      history: false,
    });
    editors.push(editor);
    editor.attach();
    editor.setSelection(["rect"]);
    await editor.executeCommand("editor.selection.delete");
    expect(left.document.nodes.rect).toBeUndefined();
    right.receive(left);
    expect(right.engine.scene.get("rect")).toBeNull();
    expect(left.undo()).toBe(true);
    right.receive(left);
    expect(right.engine.scene.get("rect")).not.toBeNull();
  });

  it("migrates every legacy discriminator into a valid Cangine scene with explicit assets and server-readable widget identity", () => {
    const legacy = representativeLegacyDocument();
    const migrated = migrateLegacyDocument(legacy);
    const snapshot = materializeSnapshot(migrated);
    const automerge = Automerge.from(migrated, { actor: ACTOR_A });
    const roundTrip = JSON.parse(
      JSON.stringify(automerge),
    ) as TCollaborativeCanvasDocument;

    expect(() => assertValidSceneSnapshot(snapshot)).not.toThrow();
    expect(Object.keys(migrated.assets)).toHaveLength(1);
    expect(Object.values(migrated.assets)[0]).toEqual({
      kind: "image",
      source: {
        kind: "url",
        value: "https://example.invalid/image.png",
      },
    });
    expect(extractWidgetInstances(migrated)).toEqual([{
      nodeId: expect.stringContaining("widget-instance"),
      definitionId: "11111111-1111-4111-8111-111111111111",
      revisionId: "22222222-2222-4222-8222-222222222222",
      instanceId: "33333333-3333-4333-8333-333333333333",
      stateDocumentId: "automerge:4P9w8qKtNvbzkexUwmBRETTKQgLf",
    }]);
    expect(
      Object.values(migrated.nodes).find((node) => {
        const authoring = node.extensions?.[AUTHORING_EXTENSION];
        return node.kind === "polygon"
          && isRecord(authoring)
          && "penSource" in authoring;
      }),
    ).toBeDefined();
    expect(
      Object.values(migrated.nodes).find((node) => node.kind === "connector"),
    ).toMatchObject({
      from: {
        type: "node",
        nodeId: fnCanvasEngineElementId({ id: "rect" }),
      },
      to: {
        type: "node",
        nodeId: fnCanvasEngineElementId({ id: "diamond" }),
      },
    });
    expect(() => materializeSnapshot(roundTrip)).not.toThrow();
  });

  it("turns one nested edit in a large node map into one patch and one Cangine upsert", () => {
    const nodes = [
      layer(),
      ...Array.from({ length: 2_000 }, (_, index) => {
        return rect(`rect-${index}`, index, String(index).padStart(8, "0"));
      }),
    ];
    let document = Automerge.from(initialDocument(nodes), { actor: ACTOR_A });
    let patches: Automerge.Patch[] = [];
    let before: Automerge.Doc<TCollaborativeCanvasDocument> | null = null;
    let after: Automerge.Doc<TCollaborativeCanvasDocument> | null = null;
    document = Automerge.change(
      document,
      {
        patchCallback(nextPatches, info) {
          patches = nextPatches;
          before = info.before;
          after = info.after;
        },
      },
      (draft) => {
        draft.nodes["rect-1000"]!.transform.position.x = 42;
      },
    );

    const commands = commandsFromAutomergePatches(
      patches,
      before!,
      after!,
    );
    expect(Object.keys(document.nodes)).toHaveLength(2_001);
    expect(patches).toEqual([{
      action: "put",
      path: ["nodes", "rect-1000", "transform", "position", "x"],
      value: 42,
    }]);
    expect(commands).toEqual([{
      type: "upsert",
      node: expect.objectContaining({ id: "rect-1000" }),
    }]);
  });
});
