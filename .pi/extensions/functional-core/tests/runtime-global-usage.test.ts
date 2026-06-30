import { describe, expect, test } from "bun:test";
import { validateNoDirectRuntimeGlobals } from "../lib/runtime-global-usage";

describe("runtime global usage check", () => {
  test("blocks direct crypto runtime usage in tx files", () => {
    const content = `
export type TPortalX = {
  crypto: typeof crypto;
};

export type TArgsX = {};

export async function txDoThing(portal: TPortalX, args: TArgsX) {
  return crypto.randomUUID();
}
`;

    expect(validateNoDirectRuntimeGlobals(content, "tx.*.ts")).toEqual([
      'line 9: direct global "crypto" not allowed in tx.*.ts; inject it through portal or another argument. Type-only refs like "typeof crypto" and member access like "portal.crypto" are allowed',
    ]);
  });

  test("allows typeof crypto in portal type and injected portal.crypto usage", () => {
    const content = `
export type TPortalX = {
  crypto: typeof crypto;
};

export type TArgsX = {};

export async function txDoThing(portal: TPortalX, args: TArgsX) {
  return portal.crypto.randomUUID();
}
`;

    expect(validateNoDirectRuntimeGlobals(content, "tx.*.ts")).toEqual([]);
  });

  test("allows type-only window references and injected portal.window access", () => {
    const content = `
export type TPortalWindow = {
  window: typeof window;
};

export type TArgsWindow = {};

type TWindowAlias = typeof window;

export async function fxReadWindow(portal: TPortalWindow, args: TArgsWindow) {
  return portal.window.location.href satisfies string;
}
`;

    expect(validateNoDirectRuntimeGlobals(content, "fx.*.ts")).toEqual([]);
  });

  test("blocks direct window runtime usage", () => {
    const content = `
export type TPortalWindow = {
  window: typeof window;
};

export type TArgsWindow = {};

export async function fxReadWindow(portal: TPortalWindow, args: TArgsWindow) {
  return window.location.href;
}
`;

    expect(validateNoDirectRuntimeGlobals(content, "fx.*.ts")).toEqual([
      'line 9: direct global "window" not allowed in fx.*.ts; inject it through portal or another argument. Type-only refs like "typeof window" and member access like "portal.window" are allowed',
    ]);
  });

  test("allows local aliases that shadow forbidden globals", () => {
    const content = `
export type TPortalX = {
  crypto: typeof crypto;
};

export type TArgsX = {};

export async function txDoThing(portal: TPortalX, args: TArgsX) {
  const crypto = portal.crypto;
  return crypto.randomUUID();
}
`;

    expect(validateNoDirectRuntimeGlobals(content, "tx.*.ts")).toEqual([]);
  });
});
