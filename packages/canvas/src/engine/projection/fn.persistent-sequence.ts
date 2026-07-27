const LEAF_SIZE = 64;

type TLeaf<T> = Readonly<{
  kind: "leaf";
  length: number;
  height: number;
  values: readonly T[];
}>;

type TBranch<T> = Readonly<{
  kind: "branch";
  length: number;
  height: number;
  left: TTree<T>;
  right: TTree<T>;
}>;

type TTree<T> = TLeaf<T> | TBranch<T>;

const STATE = Symbol("vibecanvas:persistent-sequence");

type TSequenceState<T> = Readonly<{
  tree: TTree<T> | null;
}>;

function branch<T>(left: TTree<T>, right: TTree<T>): TTree<T> {
  return Object.freeze({
    kind: "branch",
    length: left.length + right.length,
    height: Math.max(left.height, right.height) + 1,
    left,
    right,
  });
}

function buildTree<T>(values: readonly T[]): TTree<T> | null {
  let level: TTree<T>[] = [];
  for (let index = 0; index < values.length; index += LEAF_SIZE) {
    const leafValues = Object.freeze(values.slice(index, index + LEAF_SIZE));
    level.push(Object.freeze({
      kind: "leaf",
      length: leafValues.length,
      height: 1,
      values: leafValues,
    }));
  }
  while (level.length > 1) {
    const next: TTree<T>[] = [];
    for (let index = 0; index < level.length; index += 2) {
      const left = level[index]!;
      const right = level[index + 1];
      next.push(right === undefined ? left : branch(left, right));
    }
    level = next;
  }
  return level[0] ?? null;
}

function concatenate<T>(
  left: TTree<T> | null,
  right: TTree<T> | null,
): TTree<T> | null {
  if (left === null) {
    return right;
  }
  if (right === null) {
    return left;
  }
  if (left.height > right.height + 1 && left.kind === "branch") {
    return branch(
      left.left,
      concatenate(left.right, right)!,
    );
  }
  if (right.height > left.height + 1 && right.kind === "branch") {
    return branch(
      concatenate(left, right.left)!,
      right.right,
    );
  }
  return branch(left, right);
}

function splitAt<T>(
  tree: TTree<T> | null,
  index: number,
): [TTree<T> | null, TTree<T> | null] {
  if (tree === null) {
    return [null, null];
  }
  if (index <= 0) {
    return [null, tree];
  }
  if (index >= tree.length) {
    return [tree, null];
  }
  if (tree.kind === "leaf") {
    return [
      buildTree(tree.values.slice(0, index)),
      buildTree(tree.values.slice(index)),
    ];
  }
  if (index < tree.left.length) {
    const [left, remainder] = splitAt(tree.left, index);
    return [left, concatenate(remainder, tree.right)];
  }
  const [remainder, right] = splitAt(
    tree.right,
    index - tree.left.length,
  );
  return [concatenate(tree.left, remainder), right];
}

function valueAt<T>(tree: TTree<T>, index: number): T | undefined {
  if (index < 0 || index >= tree.length) {
    return undefined;
  }
  if (tree.kind === "leaf") {
    return tree.values[index];
  }
  return index < tree.left.length
    ? valueAt(tree.left, index)
    : valueAt(tree.right, index - tree.left.length);
}

function replaceAt<T>(
  tree: TTree<T>,
  index: number,
  value: T,
): TTree<T> {
  if (tree.kind === "leaf") {
    if (Object.is(tree.values[index], value)) {
      return tree;
    }
    const values = tree.values.slice();
    values[index] = value;
    return Object.freeze({
      kind: "leaf",
      length: tree.length,
      height: 1,
      values: Object.freeze(values),
    });
  }
  if (index < tree.left.length) {
    const left = replaceAt(tree.left, index, value);
    return left === tree.left ? tree : branch(left, tree.right);
  }
  const right = replaceAt(tree.right, index - tree.left.length, value);
  return right === tree.right ? tree : branch(tree.left, right);
}

function collectValues<T>(tree: TTree<T> | null, values: T[]): void {
  if (tree === null) {
    return;
  }
  if (tree.kind === "leaf") {
    values.push(...tree.values);
    return;
  }
  collectValues(tree.left, values);
  collectValues(tree.right, values);
}

function materialize<T>(state: TSequenceState<T>): T[] {
  const values: T[] = [];
  collectValues(state.tree, values);
  return values;
}

function numericIndex(property: PropertyKey): number | null {
  if (typeof property !== "string" || !/^(0|[1-9]\d*)$/.test(property)) {
    return null;
  }
  const index = Number(property);
  return Number.isSafeInteger(index) ? index : null;
}

function createProxy<T>(state: TSequenceState<T>): readonly T[] {
  // An array target preserves the published TSceneSnapshot/JSON array
  // contract (including Array.isArray) while reads are served from the
  // persistent tree and every mutation trap remains closed.
  const target: unknown[] = [];
  const values = () => materialize(state);
  return new Proxy(target, {
    get(_target, property) {
      if (property === STATE) {
        return state;
      }
      if (property === "length") {
        return state.tree?.length ?? 0;
      }
      if (property === "toJSON") {
        return values;
      }
      if (property === Symbol.iterator || property === "values") {
        return () => values().values();
      }
      if (property === "entries") {
        return () => values().entries();
      }
      if (property === "keys") {
        return () => values().keys();
      }
      const index = numericIndex(property);
      if (index !== null) {
        return state.tree === null ? undefined : valueAt(state.tree, index);
      }
      const method = typeof property === "string"
        ? (Array.prototype as unknown as Record<string, unknown>)[property]
        : undefined;
      return typeof method === "function"
        ? (...args: unknown[]) => {
            return (method as (...values: unknown[]) => unknown)
              .apply(values(), args);
          }
        : undefined;
    },
    has(_target, property) {
      if (property === STATE) {
        return true;
      }
      const index = numericIndex(property);
      return index !== null && index < (state.tree?.length ?? 0);
    },
    ownKeys() {
      return [
        ...Array.from(
          { length: state.tree?.length ?? 0 },
          (_, index) => String(index),
        ),
        "length",
      ];
    },
    getOwnPropertyDescriptor(_target, property) {
      if (property === "length") {
        return Reflect.getOwnPropertyDescriptor(target, "length");
      }
      const index = numericIndex(property);
      if (index === null || index >= (state.tree?.length ?? 0)) {
        return undefined;
      }
      return {
        configurable: true,
        enumerable: true,
        value: state.tree === null ? undefined : valueAt(state.tree, index),
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
  }) as unknown as readonly T[];
}

function stateOf<T>(value: readonly T[]): TSequenceState<T> | null {
  return (value as {
    [STATE]?: TSequenceState<T>;
  })[STATE] ?? null;
}

export function fnCreatePersistentSequence<T>(
  values: readonly T[],
): readonly T[] {
  return createProxy(Object.freeze({
    tree: buildTree(values),
  }));
}

export function fnPatchPersistentSequence<T>(args: {
  previous: readonly T[];
  replacements: readonly Readonly<{
    index: number;
    value: T;
  }>[];
}): {
  value: readonly T[];
  copiedSlots: number;
} {
  const previousState = stateOf(args.previous);
  let tree = previousState?.tree ?? buildTree(args.previous);
  const initial = tree;
  let copiedSlots = 0;
  for (const replacement of args.replacements) {
    if (
      tree === null
      || replacement.index < 0
      || replacement.index >= tree.length
    ) {
      throw new RangeError(
        `Persistent sequence index '${replacement.index}' is out of bounds.`,
      );
    }
    const next = replaceAt(tree, replacement.index, replacement.value);
    if (next !== tree) {
      copiedSlots += Math.min(LEAF_SIZE, tree.length);
    }
    tree = next;
  }
  return {
    value: tree === initial && previousState !== null
      ? args.previous
      : createProxy(Object.freeze({ tree })),
    copiedSlots,
  };
}

export function fnSplicePersistentSequence<T>(args: {
  previous: readonly T[];
  index: number;
  deleteCount: number;
  values: readonly T[];
}): {
  value: readonly T[];
  copiedSlots: number;
} {
  const previousState = stateOf(args.previous);
  const tree = previousState?.tree ?? buildTree(args.previous);
  const length = tree?.length ?? 0;
  if (
    args.index < 0
    || args.index > length
    || args.deleteCount < 0
    || args.index + args.deleteCount > length
  ) {
    throw new RangeError("Persistent sequence splice is out of bounds.");
  }
  const [left, afterIndex] = splitAt(tree, args.index);
  const [, right] = splitAt(afterIndex, args.deleteCount);
  const next = concatenate(
    concatenate(left, buildTree(args.values)),
    right,
  );
  return {
    value: createProxy(Object.freeze({ tree: next })),
    copiedSlots:
      Math.min(LEAF_SIZE, length)
      + Math.min(LEAF_SIZE, args.values.length),
  };
}

export function fnIsPersistentSequence(value: object): boolean {
  return STATE in value;
}
