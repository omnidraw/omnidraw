import { describe, expect, test } from "bun:test";
import { validateFnFileContent } from "../fn-check";

describe("fn-check", () => {
  test("allows exported fn* functions in fn files", () => {
    const content = `
export function fnCreateOrderedZIndex(index: number) {
  return index;
}
`;

    expect(validateFnFileContent("fn.create-ordered-z-index.ts", content)).toEqual([]);
  });

  test("allows exported fn* functions with direct args, portal, or portal plus args", () => {
    const content = [
      "export type TPortalThing = {};",
      "export function fnDirectArgs(value: string) {",
      "  return value;",
      "}",
      "export function fnWithPortal(portal: TPortalThing) {",
      "  return portal;",
      "}",
      "export function fnWithArgs(portal: TPortalThing, args: { value: string }) {",
      "  return args.value;",
      "}",
      "",
    ].join("\n");

    expect(validateFnFileContent("fn.do-thing.ts", content)).toEqual([]);
  });

  test("blocks exported fx* functions in fn files", () => {
    const content = `
export function fxCreateOrderedZIndex(index: number) {
  return index;
}
`;

    expect(validateFnFileContent("fn.create-ordered-z-index.ts", content)).toEqual([
      "fn.create-ordered-z-index.ts: line 1: exported function must start with fn",
    ]);
  });
});
