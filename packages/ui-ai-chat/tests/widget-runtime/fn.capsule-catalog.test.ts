import { describe, expect, test } from 'vitest';
import {
  fnAssertWidgetCapsuleRuntimeCompatible,
  fnValidateWidgetCapsuleHostCatalog,
} from '../../src/widget-runtime/fn.capsule-catalog';
import type {
  TWidgetCapsuleHostCatalog,
} from '../../src/widget-runtime/interface';
import type {
  TWidgetCapsuleBudgetRequest,
  TWidgetCapsuleRuntimeDescriptor,
} from '@omnidraw/widget-contract';

const BUDGETS: TWidgetCapsuleBudgetRequest = Object.freeze({
  cpuMs: 0.5,
  memoryBytes: 16 * 1_024 * 1_024,
  domNodes: 1_000,
  handles: 2_000,
  messageBytes: 64 * 1_024,
  streamBytes: 64 * 1_024,
  assetBytes: 0,
  networkBytes: 0,
  gpuBytes: 0,
  lifecycleBytes: 64 * 1_024,
});

const INTEGER_BUDGET_DIMENSIONS = Object.freeze([
  'memoryBytes',
  'domNodes',
  'handles',
  'messageBytes',
  'streamBytes',
  'assetBytes',
  'networkBytes',
  'gpuBytes',
  'lifecycleBytes',
] as const);

function catalog(
  limits: TWidgetCapsuleBudgetRequest = BUDGETS,
): TWidgetCapsuleHostCatalog {
  return Object.freeze({
    generation: 'fractional-cpu-budget',
    allowedApis: Object.freeze(['DOM']),
    limits,
    previewSigningKeyId: 'preview-key',
    releaseSigningKeyId: 'release-key',
    trustedSigningKeys: new Map([
      ['preview-key', {} as CryptoKey],
      ['release-key', {} as CryptoKey],
    ]),
  });
}

function descriptor(
  budgets: TWidgetCapsuleBudgetRequest = BUDGETS,
): TWidgetCapsuleRuntimeDescriptor {
  return Object.freeze({
    format: 'omnidraw.capsule-runtime.v2',
    capsuleArtifactHash: `sha256:${'a'.repeat(64)}`,
    apiContract: Object.freeze({
      format: 'capsule-api-groups-v1',
      groups: Object.freeze(['DOM']),
      bundleDigest: `sha256:${'b'.repeat(64)}`,
    }),
    budgets,
    capabilityRequests: Object.freeze([]),
    channels: null,
    parkability: Object.freeze({ parkable: false }),
    signatureKeyIds: Object.freeze(['release-key']),
  });
}

describe('Capsule widget budget catalog', () => {
  test('accepts finite fractional CPU budgets in host policy and signed artifacts', () => {
    const currentCatalog = catalog();

    expect(() => fnValidateWidgetCapsuleHostCatalog(currentCatalog)).not.toThrow();
    expect(() => fnAssertWidgetCapsuleRuntimeCompatible(
      currentCatalog,
      descriptor(),
      'published',
    )).not.toThrow();
  });

  test.each(INTEGER_BUDGET_DIMENSIONS)(
    'keeps %s constrained to safe integers',
    (dimension) => {
      const fractional = Object.freeze({
        ...BUDGETS,
        [dimension]: 0.5,
      });

      expect(() => fnValidateWidgetCapsuleHostCatalog(
        catalog(fractional),
      )).toThrow('Widget Capsule limit catalog is invalid.');
      expect(() => fnAssertWidgetCapsuleRuntimeCompatible(
        catalog(),
        descriptor(fractional),
        'published',
      )).toThrow('Widget Capsule budgets exceed the shared host limits.');
    },
  );
});
