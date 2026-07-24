import { fnCanvasProjectionSignature } from "./fn.signature";

type TWords = {
  first: number;
  second: number;
};

function fnComponentWords(args: {
  kind: "scene" | "element" | "group";
  id: string;
  signature: string;
}): TWords {
  const signature = fnCanvasProjectionSignature({
    value: [args.kind, args.id, args.signature],
  });
  return {
    first: Number.parseInt(signature.slice(3, 11), 16) >>> 0,
    second: Number.parseInt(signature.slice(11, 19), 16) >>> 0,
  };
}

function fnFormatDocumentSignature(words: TWords, count: number) {
  return `v2:${words.first.toString(16).padStart(8, "0")}${words.second.toString(16).padStart(8, "0")}:${count}`;
}

function fnParseDocumentSignature(signature: string): TWords & {
  count: number;
} {
  const match = /^v2:([0-9a-f]{8})([0-9a-f]{8}):(\d+)$/.exec(signature);
  if (match === null) {
    throw new TypeError(`Invalid canvas document projection signature '${signature}'.`);
  }
  return {
    first: Number.parseInt(match[1]!, 16) >>> 0,
    second: Number.parseInt(match[2]!, 16) >>> 0,
    count: Number.parseInt(match[3]!, 10),
  };
}

function fnToggleComponent(
  words: TWords,
  component: TWords,
): TWords {
  return {
    first: (words.first ^ component.first) >>> 0,
    second: (words.second ^ component.second) >>> 0,
  };
}

export function fnCanvasDocumentProjectionSignature(args: {
  sceneSignature: string;
  elementSignatures: Readonly<Record<string, string>>;
  groupSignatures: Readonly<Record<string, string>>;
}) {
  let words = fnComponentWords({
    kind: "scene",
    id: "base",
    signature: args.sceneSignature,
  });
  let count = 1;
  for (const [id, signature] of Object.entries(args.groupSignatures)) {
    words = fnToggleComponent(words, fnComponentWords({
      kind: "group",
      id,
      signature,
    }));
    count += 1;
  }
  for (const [id, signature] of Object.entries(args.elementSignatures)) {
    words = fnToggleComponent(words, fnComponentWords({
      kind: "element",
      id,
      signature,
    }));
    count += 1;
  }
  return fnFormatDocumentSignature(words, count);
}

export function fnUpdateCanvasDocumentProjectionSignature(args: {
  previousSignature: string;
  previousElementSignatures: Readonly<Record<string, string>>;
  nextElementSignatures: Readonly<Record<string, string>>;
  changedElementIds: readonly string[];
  previousGroupSignatures?: Readonly<Record<string, string>>;
  nextGroupSignatures?: Readonly<Record<string, string>>;
  changedGroupIds?: readonly string[];
}) {
  const previous = fnParseDocumentSignature(args.previousSignature);
  let words: TWords = {
    first: previous.first,
    second: previous.second,
  };
  let count = previous.count;
  for (const id of args.changedElementIds) {
    const before = args.previousElementSignatures[id];
    const after = args.nextElementSignatures[id];
    if (before !== undefined) {
      words = fnToggleComponent(words, fnComponentWords({
        kind: "element",
        id,
        signature: before,
      }));
      count -= 1;
    }
    if (after !== undefined) {
      words = fnToggleComponent(words, fnComponentWords({
        kind: "element",
        id,
        signature: after,
      }));
      count += 1;
    }
  }
  for (const id of args.changedGroupIds ?? []) {
    const before = args.previousGroupSignatures?.[id];
    const after = args.nextGroupSignatures?.[id];
    if (before !== undefined) {
      words = fnToggleComponent(words, fnComponentWords({
        kind: "group",
        id,
        signature: before,
      }));
      count -= 1;
    }
    if (after !== undefined) {
      words = fnToggleComponent(words, fnComponentWords({
        kind: "group",
        id,
        signature: after,
      }));
      count += 1;
    }
  }
  return fnFormatDocumentSignature(words, count);
}
