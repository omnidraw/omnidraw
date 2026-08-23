import { describe, expect, test } from 'bun:test';
import { fnWidgetServerModulePolicyAdmission } from '@omnidraw/sdk/contract';

describe('portable function module admission', () => {
  test('accepts a closed ECMAScript module and authored pure imports', () => {
    expect(fnWidgetServerModulePolicyAdmission({
      phase: 'closed_bundle',
      source: 'const add = (a, b) => a + b; export { add };',
    }))
      .toEqual({ allowed: true });
    expect(fnWidgetServerModulePolicyAdmission({
      phase: 'authored_source',
      source: [
        'import { defineServerFunction } from "@omnidraw/sdk/server";',
        'import { z } from "zod";',
        'export const value = Object.freeze({ ok: true });',
      ].join('\n'),
    })).toEqual({ allowed: true });
  });

  test('rejects adapter, OS, network, timer, loader, and shared-memory authority', () => {
    const vectors = [
      'Bun.file("secret")',
      'process.env.SECRET',
      'fetch("https://example.test")',
      'new WebSocket("wss://example.test")',
      'setTimeout(() => {}, 1)',
      'queueMicrotask(() => {})',
      'new SharedArrayBuffer(8)',
      'WebAssembly.compile(bytes)',
      'import("./dynamic.js")',
      'require("fs")',
      'new Function("return 1")',
      'crypto.getRandomValues(bytes)',
    ];
    for (const source of vectors) {
      expect(fnWidgetServerModulePolicyAdmission({
        phase: 'closed_bundle',
        source,
      }), source).toMatchObject({ allowed: false });
    }
  });

  test('rejects runtime-specific authored module specifiers', () => {
    for (const specifier of [
      'node:fs',
      'bun:sqlite',
      'cloudflare:workers',
      'wrangler',
      'workerd/runtime',
      'miniflare',
    ]) {
      expect(fnWidgetServerModulePolicyAdmission({
        phase: 'authored_source',
        source: `import value from ${JSON.stringify(specifier)};`,
      }), specifier)
        .toMatchObject({ allowed: false });
    }
  });
});
