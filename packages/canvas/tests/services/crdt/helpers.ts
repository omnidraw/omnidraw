import { Repo, type DocHandle, type PeerId } from "@automerge/automerge-repo";
import type { TCanvasDoc, TElement, TGroup, TTextData } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import { fxCreateCrdtBuilder } from "../../../src/services/crdt/fxBuilder";

export function createCanvasDoc(overrides?: Partial<TCanvasDoc>): TCanvasDoc {
  return {
    id: "doc-1",
    name: "doc-1",
    elements: {},
    groups: {},
    ...overrides,
  };
}

export function createRealDocHandle(overrides?: Partial<TCanvasDoc>): {
  repo: Repo;
  docHandle: DocHandle<TCanvasDoc>;
} {
  const repo = new Repo({
    peerId: `test-${Math.random().toString(36).slice(2)}` as PeerId,
  });
  const docHandle = repo.create<TCanvasDoc>(createCanvasDoc(overrides));
  return {
    repo,
    docHandle,
  };
}

export function cloneForTest<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function createBuilder(docHandle: DocHandle<TCanvasDoc>) {
  return fxCreateCrdtBuilder({
    docHandle,
    clone: cloneForTest,
  }, {});
}

export function createTextData(overrides?: Partial<TTextData>): TTextData {
  return {
    type: "text",
    w: 120,
    h: 40,
    text: "hello",
    originalText: "hello",
    fontFamily: "Arial",
    link: null,
    containerId: null,
    autoResize: false,
    ...overrides,
  };
}

export function createElement(id: string, overrides?: Partial<TElement>): TElement {
  return {
    id,
    x: 10,
    y: 20,
    rotation: 0,
    zIndex: `z-${id}`,
    parentGroupId: null,
    bindings: [],
    locked: false,
    createdAt: 1,
    updatedAt: 2,
    data: createTextData(),
    style: {
      opacity: 1,
      strokeColor: "#000000",
      backgroundColor: "#ffffff",
    },
    ...overrides,
  };
}

export function createGroup(id: string, overrides?: Partial<TGroup>): TGroup {
  return {
    id,
    parentGroupId: null,
    zIndex: `g-${id}`,
    locked: false,
    createdAt: 1,
    ...overrides,
  };
}
