import { describe, expect, test } from "bun:test";
import { validateFxFileContent } from "../fx-check";

describe("fx-check", () => {
  test("allows exported fx* functions with only required portal param", () => {
    const content = [
      "export type TPortalThing = {};",
      "",
      "export function fxDoThing(portal: TPortalThing) {",
      "  return portal;",
      "}",
      "",
    ].join("\n");

    expect(validateFxFileContent("fx.do-thing.ts", content)).toEqual([]);
  });

  test("allows exported fx* functions with optional args second param", () => {
    const content = [
      "export type TPortalThing = {};",
      "export type TArgsThing = {};",
      "",
      "export function fxDoThing(portal: TPortalThing, args?: TArgsThing) {",
      "  return args ?? portal;",
      "}",
      "",
    ].join("\n");

    expect(validateFxFileContent("fx.do-thing.ts", content)).toEqual([]);
  });

  test("blocks optional portal param in exported fx* functions", () => {
    const content = [
      "export type TPortalThing = {};",
      "",
      "export function fxDoThing(portal?: TPortalThing) {",
      "  return portal;",
      "}",
      "",
    ].join("\n");

    expect(validateFxFileContent("fx.do-thing.ts", content)).toEqual([
      "fx.do-thing.ts: line 2: fxDoThing first parameter must be named portal and typed as TPortal*",
    ]);
  });
});
