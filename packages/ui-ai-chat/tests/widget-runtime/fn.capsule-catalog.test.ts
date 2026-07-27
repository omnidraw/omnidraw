import { describe, expect, test } from 'vitest';
import {
  fnAssertWidgetCapsuleRuntimeCompatible,
  fnValidateWidgetCapsuleHostCatalog,
} from '../../src/widget-runtime/fn.capsule-catalog';
import type {
  TWidgetCapsuleHostCatalog,
} from '../../src/widget-runtime/interface';
import type {
  TWidgetCapsuleBudgets,
  TWidgetCapsuleRuntimeDescriptor,
} from '@vibecanvas/widget-contract';

const BUDGETS: TWidgetCapsuleBudgets = Object.freeze({
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
  budgetCeiling: TWidgetCapsuleBudgets = BUDGETS,
  budgetDefaults: TWidgetCapsuleBudgets = BUDGETS,
): TWidgetCapsuleHostCatalog {
  return Object.freeze({
    generation: 'fractional-cpu-budget',
    targetBase: Object.freeze({
      runtimeAbi: 'quickjs-release-sync-v1',
      domProfile: 'dom-core-v2',
    }),
    allowedFeatureProfiles: Object.freeze([]),
    budgetCeiling,
    budgetDefaults,
    previewSigningKeyId: 'preview-key',
    releaseSigningKeyId: 'release-key',
    trustedSigningKeys: new Map([
      ['preview-key', {} as CryptoKey],
      ['release-key', {} as CryptoKey],
    ]),
  });
}

function descriptor(
  budgets: TWidgetCapsuleBudgets = BUDGETS,
): TWidgetCapsuleRuntimeDescriptor {
  return Object.freeze({
    format: 'vibecanvas.capsule-runtime.v1',
    capsuleArtifactHash: `sha256:${'a'.repeat(64)}`,
    target: Object.freeze({
      runtimeAbi: 'quickjs-release-sync-v1',
      domProfile: 'dom-core-v2',
      featureProfiles: Object.freeze([]),
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
        catalog(fractional, fractional),
      )).toThrow('Widget Capsule budget catalog is invalid.');
      expect(() => fnAssertWidgetCapsuleRuntimeCompatible(
        catalog(),
        descriptor(fractional),
        'published',
      )).toThrow('Widget Capsule budgets exceed the shared host catalog.');
    },
  );
});
