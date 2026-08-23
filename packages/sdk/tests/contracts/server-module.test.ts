import { createHash } from 'node:crypto';
import { describe, expect, test } from 'bun:test';
import {
  WIDGET_SERVER_ALLOWED_PACKAGE_IMPORTS,
  WIDGET_SERVER_MODULE_ABI,
  WIDGET_SERVER_MODULE_FORMAT,
  WIDGET_SERVER_MODULE_MAX_BYTES,
  WidgetServerFunctionDescriptorValidator,
  fnCreateWidgetServerModuleArtifact,
  fnValidateWidgetServerModuleArtifact,
  fnWidgetServerModulePolicyAdmission,
  type TWidgetServerFunctionDescriptor,
} from '@omnidraw/sdk/contract';
import { TEST_SERVER_FUNCTION_DESCRIPTOR } from './function-descriptor.fixture';

const sha256 = (value: string | Uint8Array): string => (
  createHash('sha256').update(value).digest('hex')
);

function descriptor(exportName: string): TWidgetServerFunctionDescriptor {
  return Object.freeze({ ...TEST_SERVER_FUNCTION_DESCRIPTOR, exportName });
}

describe('canonical widget server module', () => {
  test('derives fixed adapter-neutral identity and canonical descriptor order', () => {
    const source = new TextEncoder().encode('export const run = 1;');
    const artifact = fnCreateWidgetServerModuleArtifact({
      moduleBytes: source,
      functionDescriptors: [descriptor('zeta'), descriptor('alpha')],
      digestSha256: sha256,
    });

    source[0] = 0;
    expect(artifact.kind).toBe('server_module');
    expect(artifact.format).toBe(WIDGET_SERVER_MODULE_FORMAT);
    expect(artifact.abi).toBe(WIDGET_SERVER_MODULE_ABI);
    expect(artifact.moduleDigestSha256).toBe(sha256(artifact.moduleBytes));
    expect(artifact.functionDescriptorsDigestSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(artifact.moduleBytes[0]).not.toBe(0);
    expect(artifact.functionDescriptors.map((item) => item.exportName)).toEqual([
      'alpha',
      'zeta',
    ]);
    expect(fnValidateWidgetServerModuleArtifact({ artifact, digestSha256: sha256 }))
      .toEqual({ valid: true });
  });

  test('rejects adapter metadata, byte drift, descriptor drift, and source paths', () => {
    const artifact = fnCreateWidgetServerModuleArtifact({
      moduleBytes: new TextEncoder().encode('export const run = 1;'),
      functionDescriptors: [TEST_SERVER_FUNCTION_DESCRIPTOR],
      digestSha256: sha256,
    });
    const invalid = [
      [{ ...artifact, abi: 'bun-v1' }, 'contract_mismatch'],
      [{ ...artifact, moduleBytes: new TextEncoder().encode('changed') }, 'module_digest_mismatch'],
      [{ ...artifact, functionDescriptors: [] }, 'function_count_invalid'],
      [{
        ...artifact,
        functionDescriptors: [descriptor('zeta'), descriptor('alpha')],
      }, 'function_order_invalid'],
      [{ ...artifact, functionDescriptorsDigestSha256: '0'.repeat(64) }, 'function_digest_mismatch'],
    ] as const;
    for (const [candidate, reason] of invalid) {
      expect(fnValidateWidgetServerModuleArtifact({
        artifact: candidate as typeof artifact,
        digestSha256: sha256,
      })).toEqual({ valid: false, reason });
    }
    expect(WidgetServerFunctionDescriptorValidator.safeParse({
      ...TEST_SERVER_FUNCTION_DESCRIPTOR,
      modulePath: 'server/main.ts',
    }).success).toBe(false);
    expect(WidgetServerFunctionDescriptorValidator.safeParse({
      ...TEST_SERVER_FUNCTION_DESCRIPTOR,
      limits: { ...TEST_SERVER_FUNCTION_DESCRIPTOR.limits, memoryTier: 'medium' },
    }).success).toBe(false);
    expect(() => fnCreateWidgetServerModuleArtifact({
      moduleBytes: new Uint8Array(WIDGET_SERVER_MODULE_MAX_BYTES + 1),
      functionDescriptors: [TEST_SERVER_FUNCTION_DESCRIPTOR],
      digestSha256: sha256,
    })).toThrow(/byte limit/);
  });
});

describe('widget server module portability policy', () => {
  test('pins the complete portable server package-import profile', () => {
    expect(WIDGET_SERVER_ALLOWED_PACKAGE_IMPORTS).toEqual([
      '@omnidraw/sdk/server',
      'typebox',
    ]);
  });

  test('allows authored package imports but requires a closed bundle with no imports', () => {
    expect(fnWidgetServerModulePolicyAdmission({
      phase: 'authored_source',
      source: 'import { defineServerFunction } from "@omnidraw/sdk/server"; export const run = defineServerFunction;',
    })).toEqual({ allowed: true });
    expect(fnWidgetServerModulePolicyAdmission({
      phase: 'closed_bundle',
      source: 'export const run = Object.freeze({ value: Promise.resolve(1) });',
    })).toEqual({ allowed: true });
    expect(fnWidgetServerModulePolicyAdmission({
      phase: 'closed_bundle',
      source: 'import { z } from "zod"; export { z };',
    })).toEqual({ allowed: false, phase: 'closed_bundle', token: 'static_import' });
  });

  test('returns stable capability tokens for forbidden source and bundle authority', () => {
    const cases = [
      ['import { readFile } from "node:fs";', 'filesystem'],
      ['import { WorkerEntrypoint } from "cloudflare:workers";', 'adapter_module'],
      ['import runtime from "workerd/runtime";', 'adapter_module'],
      ['const value = require("pure-package");', 'commonjs_loader'],
      ['const value = import("pure-package");', 'dynamic_import'],
      ['const token = process.env.TOKEN;', 'environment'],
      ['const value = fetch("https://example.test");', 'network'],
      ['const timer = setTimeout(() => {}, 1);', 'timer'],
      ['const shared = new SharedArrayBuffer(8);', 'shared_memory'],
    ] as const;
    for (const [source, token] of cases) {
      expect(fnWidgetServerModulePolicyAdmission({
        phase: 'authored_source',
        source,
      })).toEqual({ allowed: false, phase: 'authored_source', token });
    }
    expect(fnWidgetServerModulePolicyAdmission({
      phase: 'closed_bundle',
      source: '// fetch("ignored")\nconst text = "process setTimeout";',
    })).toEqual({ allowed: true });
  });

  test('rejects dynamic code, WebAssembly, and worker adapter globals with fixed tokens', () => {
    const vectors = [
      ['eval("1 + 1")', 'dynamic_code_generation'],
      ['new Function("return 1")', 'dynamic_code_generation'],
      ['Function("return 1")', 'dynamic_code_generation'],
      ['WebAssembly.compile(bytes)', 'webassembly'],
      ['navigator.userAgent', 'worker_adapter_global'],
      ['caches.open("widget")', 'worker_adapter_global'],
      ['waitUntil(promise)', 'worker_adapter_global'],
      ['checkpoint()', 'worker_adapter_global'],
      ['scheduleAt(instant)', 'worker_adapter_global'],
      ['self["fetch"]("https://example.invalid")', 'worker_adapter_global'],
      ['([]["filter"]["constructor"])("return Date.now()")()', 'dynamic_code_generation'],
      ['Math.sin.constructor("return Date.now()")()', 'dynamic_code_generation'],
    ] as const;
    for (const [source, token] of vectors) {
      expect(fnWidgetServerModulePolicyAdmission({
        phase: 'closed_bundle',
        source,
      }), source).toEqual({ allowed: false, phase: 'closed_bundle', token });
    }
  });

  test('rejects timer and adapter-global aliases while retaining ECMAScript Math', () => {
    const vectors = [
      ['`${Date.now()}`;', 'timer'],
      ['globalThis["fetch"]("https://example.invalid");', 'worker_adapter_global'],
      ['console.log("bypass");', 'worker_adapter_global'],
      ['performance.now();', 'timer'],
    ] as const;
    for (const [source, token] of vectors) {
      expect(fnWidgetServerModulePolicyAdmission({
        phase: 'authored_source',
        source,
      }), source).toEqual({ allowed: false, phase: 'authored_source', token });
    }
    expect(fnWidgetServerModulePolicyAdmission({
      phase: 'closed_bundle',
      source: 'const value = `${Math.abs(-1) + Math.random()}`;',
    })).toEqual({ allowed: true });
  });
});
