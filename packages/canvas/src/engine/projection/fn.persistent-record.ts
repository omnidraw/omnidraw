type TNode<T> = Readonly<{
  key: string;
  value: T;
  left: TNode<T> | null;
  right: TNode<T> | null;
  height: number;
  size: number;
}>;

type TPersistentRecordState<T> = Readonly<{
  root: TNode<T> | null;
}>;

const STATE = Symbol("vibecanvas:persistent-record");

function height<T>(node: TNode<T> | null): number {
  return node?.height ?? 0;
}

function makeNode<T>(
  key: string,
  value: T,
  left: TNode<T> | null,
  right: TNode<T> | null,
): TNode<T> {
  return Object.freeze({
    key,
    value,
    left,
    right,
    height: Math.max(height(left), height(right)) + 1,
    size: (left?.size ?? 0) + (right?.size ?? 0) + 1,
  });
}

function rotateLeft<T>(node: TNode<T>): TNode<T> {
  const right = node.right!;
  return makeNode(
    right.key,
    right.value,
    makeNode(node.key, node.value, node.left, right.left),
    right.right,
  );
}

function rotateRight<T>(node: TNode<T>): TNode<T> {
  const left = node.left!;
  return makeNode(
    left.key,
    left.value,
    left.left,
    makeNode(node.key, node.value, left.right, node.right),
  );
}

function balance<T>(node: TNode<T>): TNode<T> {
  const delta = height(node.left) - height(node.right);
  if (delta > 1) {
    const left = node.left!;
    const adjusted = height(left.left) < height(left.right)
      ? makeNode(node.key, node.value, rotateLeft(left), node.right)
      : node;
    return rotateRight(adjusted);
  }
  if (delta < -1) {
    const right = node.right!;
    const adjusted = height(right.right) < height(right.left)
      ? makeNode(node.key, node.value, node.left, rotateRight(right))
      : node;
    return rotateLeft(adjusted);
  }
  return node;
}

function setNode<T>(
  node: TNode<T> | null,
  key: string,
  value: T,
): TNode<T> {
  if (node === null) {
    return makeNode(key, value, null, null);
  }
  if (key === node.key) {
    return Object.is(value, node.value)
      ? node
      : makeNode(key, value, node.left, node.right);
  }
  return key < node.key
    ? balance(makeNode(
        node.key,
        node.value,
        setNode(node.left, key, value),
        node.right,
      ))
    : balance(makeNode(
        node.key,
        node.value,
        node.left,
        setNode(node.right, key, value),
      ));
}

function minimum<T>(node: TNode<T>): TNode<T> {
  return node.left === null ? node : minimum(node.left);
}

function deleteNode<T>(
  node: TNode<T> | null,
  key: string,
): TNode<T> | null {
  if (node === null) {
    return null;
  }
  if (key < node.key) {
    const left = deleteNode(node.left, key);
    return left === node.left
      ? node
      : balance(makeNode(node.key, node.value, left, node.right));
  }
  if (key > node.key) {
    const right = deleteNode(node.right, key);
    return right === node.right
      ? node
      : balance(makeNode(node.key, node.value, node.left, right));
  }
  if (node.left === null) {
    return node.right;
  }
  if (node.right === null) {
    return node.left;
  }
  const successor = minimum(node.right);
  return balance(makeNode(
    successor.key,
    successor.value,
    node.left,
    deleteNode(node.right, successor.key),
  ));
}

function getNode<T>(node: TNode<T> | null, key: string): T | undefined {
  let current = node;
  while (current !== null) {
    if (key === current.key) {
      return current.value;
    }
    current = key < current.key ? current.left : current.right;
  }
  return undefined;
}

function collectEntries<T>(
  node: TNode<T> | null,
  entries: [string, T][],
): void {
  if (node === null) {
    return;
  }
  collectEntries(node.left, entries);
  entries.push([node.key, node.value]);
  collectEntries(node.right, entries);
}

function stateOf<T>(
  value: Readonly<Record<string, T>>,
): TPersistentRecordState<T> | null {
  return (value as {
    [STATE]?: TPersistentRecordState<T>;
  })[STATE] ?? null;
}

function createProxy<T>(
  state: TPersistentRecordState<T>,
): Readonly<Record<string, T>> {
  const target = {};
  return new Proxy(target, {
    get(_target, property) {
      if (property === STATE) {
        return state;
      }
      if (typeof property === "string") {
        return getNode(state.root, property);
      }
      return undefined;
    },
    has(_target, property) {
      if (property === STATE) {
        return true;
      }
      return typeof property === "string"
        && getNode(state.root, property) !== undefined;
    },
    ownKeys() {
      const entries: [string, T][] = [];
      collectEntries(state.root, entries);
      return entries.map(([key]) => key);
    },
    getOwnPropertyDescriptor(_target, property) {
      if (
        typeof property !== "string"
        || getNode(state.root, property) === undefined
      ) {
        return undefined;
      }
      return {
        configurable: true,
        enumerable: true,
        value: getNode(state.root, property),
        writable: false,
      };
    },
    set() {
      return false;
    },
    deleteProperty() {
      return false;
    },
    defineProperty() {
      return false;
    },
  }) as Readonly<Record<string, T>>;
}

export function fnCreatePersistentRecord<T>(
  value: Readonly<Record<string, T>>,
): Readonly<Record<string, T>> {
  if (stateOf(value) !== null) {
    return value;
  }
  let root: TNode<T> | null = null;
  for (const [key, entry] of Object.entries(value)) {
    root = setNode(root, key, entry);
  }
  return createProxy(Object.freeze({ root }));
}

export function fnPatchPersistentRecord<T>(args: {
  previous: Readonly<Record<string, T>>;
  changes: readonly Readonly<{
    key: string;
    value: T | undefined;
  }>[];
}): Readonly<Record<string, T>> {
  let root = stateOf(args.previous)?.root ?? null;
  if (root === null && Object.keys(args.previous).length > 0) {
    return fnPatchPersistentRecord({
      previous: fnCreatePersistentRecord(args.previous),
      changes: args.changes,
    });
  }
  const initial = root;
  for (const change of args.changes) {
    root = change.value === undefined
      ? deleteNode(root, change.key)
      : setNode(root, change.key, change.value);
  }
  return root === initial
    ? args.previous
    : createProxy(Object.freeze({ root }));
}

export function fnIsPersistentRecord(value: object): boolean {
  return STATE in value;
}

const SET_STATE = Symbol("vibecanvas:persistent-string-set");

type TPersistentStringSetState = Readonly<{
  record: Readonly<Record<string, true>>;
}>;

function createPersistentStringSetProxy(
  record: Readonly<Record<string, true>>,
): ReadonlySet<string> {
  const state = Object.freeze({ record });
  return Object.freeze({
    get size() {
      return stateOf(record)?.root?.size ?? Object.keys(record).length;
    },
    has(value: string) {
      return record[value] === true;
    },
    entries() {
      return Object.keys(record).map((key) => [key, key] as [string, string])
        .values();
    },
    keys() {
      return Object.keys(record).values();
    },
    values() {
      return Object.keys(record).values();
    },
    forEach(
      callback: (
        value: string,
        valueAgain: string,
        set: ReadonlySet<string>,
      ) => void,
      thisArg?: unknown,
    ) {
      for (const key of Object.keys(record)) {
        callback.call(
          thisArg,
          key,
          key,
          this as unknown as ReadonlySet<string>,
        );
      }
    },
    [Symbol.iterator]() {
      return Object.keys(record).values();
    },
    [SET_STATE]: state,
  }) as unknown as ReadonlySet<string>;
}

export function fnCreatePersistentStringSet(
  values: readonly string[],
): ReadonlySet<string> {
  return createPersistentStringSetProxy(fnCreatePersistentRecord(
    Object.fromEntries(values.map((value) => [value, true])),
  ));
}

export function fnPatchPersistentStringSet(args: {
  previous: ReadonlySet<string>;
  added: readonly string[];
  deleted: readonly string[];
}): ReadonlySet<string> {
  const state = (args.previous as {
    [SET_STATE]?: TPersistentStringSetState;
  })[SET_STATE];
  const record = state?.record ?? fnCreatePersistentRecord(Object.fromEntries(
    [...args.previous].map((value) => [value, true]),
  ));
  const next = fnPatchPersistentRecord({
    previous: record,
    changes: [
      ...args.deleted.map((key) => ({ key, value: undefined })),
      ...args.added.map((key) => ({ key, value: true as const })),
    ],
  });
  return next === record
    ? args.previous
    : createPersistentStringSetProxy(next);
}
