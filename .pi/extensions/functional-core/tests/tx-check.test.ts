import { describe, expect, test } from "bun:test";
import { validateTxFileContent } from "../tx-check";

describe("tx-check", () => {
  test("allows exported tx* functions with only required portal param", () => {
    const content = [
      "export type TPortalThing = {};",
      "",
      "export function txDoThing(portal: TPortalThing) {",
      "  return portal;",
      "}",
      "",
    ].join("\n");

    expect(validateTxFileContent("tx.do-thing.ts", content)).toEqual([]);
  });

  test("allows exported tx* functions with optional args second param", () => {
    const content = [
      "export type TPortalThing = {};",
      "export type TArgsThing = {};",
      "",
      "export function txDoThing(portal: TPortalThing, args?: TArgsThing) {",
      "  return args ?? portal;",
      "}",
      "",
    ].join("\n");

    expect(validateTxFileContent("tx.do-thing.ts", content)).toEqual([]);
  });

  test("blocks optional portal param in exported tx* functions", () => {
    const content = [
      "export type TPortalThing = {};",
      "",
      "export function txDoThing(portal?: TPortalThing) {",
      "  return portal;",
      "}",
      "",
    ].join("\n");

    expect(validateTxFileContent("tx.do-thing.ts", content)).toEqual([
      "tx.do-thing.ts: line 2: txDoThing first parameter must be named portal and typed as TPortal*",
    ]);
  });
});
