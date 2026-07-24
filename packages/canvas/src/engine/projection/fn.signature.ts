import { fnCanonicalCanvasJson } from "./fn.json";

type TArgsProjectionSignature = {
  value: unknown;
};

export function fnCanvasProjectionSignature(args: TArgsProjectionSignature): string {
  const canonical = fnCanonicalCanvasJson({ value: args.value });
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;

  for (let index = 0; index < canonical.length; index += 1) {
    const code = canonical.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193) >>> 0;
    second = Math.imul(second ^ code, 0x85ebca6b) >>> 0;
  }

  return `v1:${first.toString(16).padStart(8, "0")}${second.toString(16).padStart(8, "0")}:${canonical.length}`;
}
