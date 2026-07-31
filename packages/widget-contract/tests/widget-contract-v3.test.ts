import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import {
  ZWidgetCapsuleRuntimeDescriptor,
  ZWidgetManifestV3,
  fnCanonicalizeWidgetCapsuleCapabilityRequests,
  fnCanonicalizeWidgetCapsuleChannelContract,
  fnCanonicalizeWidgetBrowserFunctionDescriptors,
  fnCanonicalizeWidgetContractPayload,
  fnCanonicalizeWidgetManifest,
  fnCanonicalizeWidgetServerFunctionDescriptors,
  fnGenerateWidgetServerFunctionClientModule,
  fnProjectWidgetBrowserFunctionDescriptors,
} from '../src';
import {
  CAPSULE_BUDGETS,
  CAPSULE_API_CONTRACT,
  CAPSULE_BUILD_IDENTITY,
  CAPSULE_HASH_A,
  CAPSULE_HASH_B,
  CAPSULE_MANIFEST,
  CAPSULE_RUNTIME_DESCRIPTOR,
  RAW_DIGEST_A,
  RAW_DIGEST_B,
} from './capsule.fixture';

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

function contract(overrides: Record<string, unknown> = {}): string {
  return sha256(fnCanonicalizeWidgetContractPayload({
    canonicalManifestJson: fnCanonicalizeWidgetManifest(CAPSULE_MANIFEST),
    uiDigestSha256: RAW_DIGEST_A,
    capsuleArtifactHash: CAPSULE_HASH_A,
    apiContract: CAPSULE_API_CONTRACT,
    budgets: CAPSULE_BUDGETS,
    capabilityContractDigestSha256: RAW_DIGEST_A,
    channelContractDigestSha256: RAW_DIGEST_B,
    signatureKeyIds: ['omnidraw-release-v1'],
    serverDigestSha256: null,
    serverRuntimeAbi: null,
    functionDescriptorsDigestSha256: RAW_DIGEST_A,
    sourceDigestSha256: RAW_DIGEST_B,
    builderIdentity: 'capsule-builder-v1',
    capsuleBuildIdentity: CAPSULE_BUILD_IDENTITY,
    buildPolicyId: 'omnidraw-capsule-widget-v1',
    ...overrides,
  }));
}

describe('widget manifest v3', () => {
  test('strictly validates, normalizes, and canonicalizes Capsule intent', () => {
    const parsed = ZWidgetManifestV3.parse({
      ...CAPSULE_MANIFEST,
      ui: {
        ...CAPSULE_MANIFEST.ui,
        apis: ['CANVAS_2D', 'DOM'],
        budgets: { cpuMs: 0, networkBytes: 0 },
        state: { collaborative: true, localStore: 'ephemeral' },
        parkability: { enabled: false },
      },
    });
    expect(parsed.ui.apis).toEqual(['DOM', 'CANVAS_2D']);
    expect(parsed.ui.budgets).toEqual({ cpuMs: 0, networkBytes: 0 });
    expect(JSON.parse(fnCanonicalizeWidgetManifest(parsed))).toEqual(parsed);
  });

  test('rejects v2, unknown fields, duplicate or conflicting APIs, snapshot state, and parking', () => {
    expect(ZWidgetManifestV3.safeParse({
      schemaVersion: 2,
      name: 'old',
      slug: 'old',
      ui: { entry: 'src/ui.ts' },
    }).success).toBe(false);
    expect(ZWidgetManifestV3.safeParse({
      ...CAPSULE_MANIFEST,
      authority: 'guest-chosen',
    }).success).toBe(false);
    expect(ZWidgetManifestV3.safeParse({
      ...CAPSULE_MANIFEST,
      ui: {
        ...CAPSULE_MANIFEST.ui,
        apis: ['DOM', 'DOM'],
      },
    }).success).toBe(false);
    expect(ZWidgetManifestV3.safeParse({
      ...CAPSULE_MANIFEST,
      ui: {
        ...CAPSULE_MANIFEST.ui,
        apis: ['DOM', 'WEBGL', 'WEBGPU'],
      },
    }).success).toBe(false);
    expect(ZWidgetManifestV3.safeParse({
      ...CAPSULE_MANIFEST,
      ui: {
        ...CAPSULE_MANIFEST.ui,
        target: { runtimeAbi: 'private', domProfile: 'private', featureProfiles: [] },
      },
    }).success).toBe(false);
    expect(ZWidgetManifestV3.safeParse({
      ...CAPSULE_MANIFEST,
      ui: { ...CAPSULE_MANIFEST.ui, parkability: { enabled: true } },
    }).success).toBe(false);
    expect(ZWidgetManifestV3.safeParse({
      ...CAPSULE_MANIFEST,
      ui: {
        ...CAPSULE_MANIFEST.ui,
        state: { collaborative: false, localStore: 'snapshot' },
      },
    }).success).toBe(false);
  });

});

describe('Capsule widget contract v4', () => {
  test('binds every runtime-authority identity independently', () => {
    const baseline = contract();
    const mutations = [
      {
        canonicalManifestJson: fnCanonicalizeWidgetManifest({
          ...CAPSULE_MANIFEST,
          name: 'Changed example',
        }),
      },
      { uiDigestSha256: RAW_DIGEST_B },
      { capsuleArtifactHash: CAPSULE_HASH_B },
      {
        apiContract: {
          ...CAPSULE_API_CONTRACT,
          groups: ['DOM', 'WEBGL'],
        },
      },
      { budgets: { ...CAPSULE_BUDGETS, cpuMs: CAPSULE_BUDGETS.cpuMs + 1 } },
      { capabilityContractDigestSha256: RAW_DIGEST_B },
      { channelContractDigestSha256: RAW_DIGEST_A },
      { signatureKeyIds: ['another-release-key'] },
      { serverDigestSha256: RAW_DIGEST_B },
      { serverRuntimeAbi: 'omnidraw-function-v2' },
      { functionDescriptorsDigestSha256: RAW_DIGEST_B },
      { sourceDigestSha256: RAW_DIGEST_A },
      { builderIdentity: 'different-builder' },
      {
        capsuleBuildIdentity: {
          ...CAPSULE_BUILD_IDENTITY,
          runtimeBuildDigest: CAPSULE_HASH_A,
        },
      },
      { buildPolicyId: 'different-policy' },
    ];
    for (const mutation of mutations) expect(contract(mutation)).not.toBe(baseline);
  });

  test('strictly decodes signed runtime metadata', () => {
    expect(ZWidgetCapsuleRuntimeDescriptor.parse(CAPSULE_RUNTIME_DESCRIPTOR))
      .toEqual(CAPSULE_RUNTIME_DESCRIPTOR);
    expect(ZWidgetCapsuleRuntimeDescriptor.safeParse({
      ...CAPSULE_RUNTIME_DESCRIPTOR,
      signatureKeyIds: [],
    }).success).toBe(false);
    expect(ZWidgetCapsuleRuntimeDescriptor.safeParse({
      ...CAPSULE_RUNTIME_DESCRIPTOR,
      privateKey: 'forbidden',
    }).success).toBe(false);
  });

  test('canonicalizes capability and channel contracts', () => {
    expect(fnCanonicalizeWidgetCapsuleCapabilityRequests([])).toContain(
      'omnidraw.capsule-capability-contract.v1',
    );
    expect(fnCanonicalizeWidgetCapsuleChannelContract(null)).toContain(
      'omnidraw.capsule-channel-contract.v1',
    );
  });

  test('defines module-path-free browser descriptor canonicalization', () => {
    const descriptor = {
      schemaVersion: 1 as const,
      exportName: 'save',
      modulePath: 'src/private/save.ts',
      effect: 'fn' as const,
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object' },
      resources: [],
      limits: {
        timeoutMs: 1_000,
        memoryTier: 'small' as const,
        outputByteLimit: 1_024,
        logByteLimit: 0,
      },
      retry: {
        mode: 'none' as const,
        maxAttempts: 1,
        initialBackoffMs: 0,
        maxBackoffMs: 0,
      },
    };
    const changedPath = { ...descriptor, modulePath: 'src/private/moved.ts' };
    const browser = fnProjectWidgetBrowserFunctionDescriptors([descriptor]);
    const movedBrowser = fnProjectWidgetBrowserFunctionDescriptors([changedPath]);
    const canonical = fnCanonicalizeWidgetBrowserFunctionDescriptors(browser);

    expect(browser[0]).not.toHaveProperty('modulePath');
    expect(fnCanonicalizeWidgetBrowserFunctionDescriptors(movedBrowser)).toBe(canonical);
    expect(fnCanonicalizeWidgetServerFunctionDescriptors([changedPath]))
      .not.toBe(fnCanonicalizeWidgetServerFunctionDescriptors([descriptor]));
    for (const mutation of [
      { ...browser[0]!, effect: 'tx' as const },
      { ...browser[0]!, inputSchema: { type: 'string' } },
      {
        ...browser[0]!,
        limits: { ...browser[0]!.limits, timeoutMs: 2_000 },
      },
    ]) {
      expect(fnCanonicalizeWidgetBrowserFunctionDescriptors([mutation])).not.toBe(canonical);
    }
  });

  test('embeds the exact generated Capsule selector in server clients', () => {
    const source = fnGenerateWidgetServerFunctionClientModule({
      descriptors: [{
        schemaVersion: 1,
        exportName: 'save',
        modulePath: 'src/server.ts',
        effect: 'tx',
        inputSchema: { type: 'object' },
        outputSchema: { type: 'object' },
        resources: [],
        limits: {
          timeoutMs: 1_000,
          memoryTier: 'small',
          outputByteLimit: 1_024,
          logByteLimit: 0,
        },
        retry: {
          mode: 'none',
          maxAttempts: 1,
          initialBackoffMs: 0,
          maxBackoffMs: 0,
        },
      }],
      serverModuleSpecifier: './src/server.ts',
      capabilitySelector: {
        id: `omnidraw.widget.functions.h${RAW_DIGEST_A}`,
        versionRange: '1.0.0',
        contractHash: CAPSULE_HASH_A,
      },
    });
    expect(source).toContain(`omnidraw.widget.functions.h${RAW_DIGEST_A}`);
    expect(source).toContain(CAPSULE_HASH_A);
    expect(source).toContain('__omnidrawCreateProxy("save"');
  });
});
