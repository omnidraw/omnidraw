/**
 * @file Pure normalization for Capsule metadata copied into widget contracts.
 */

import type {
  TWidgetCapsuleBudgetRequest,
  TWidgetCapsuleBudgets,
  TWidgetCapsuleCapabilityRequest,
  TWidgetCapsuleChannelContract,
  TWidgetCapsuleRuntimeDescriptor,
  TWidgetCapsuleSchemaReference,
  TWidgetCapsuleTarget,
} from '../types';

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortedUnique(values: readonly string[], label: string): readonly string[] {
  const sorted = [...values].sort(compareText);
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index - 1] === sorted[index]) {
      throw new TypeError(`${label} must not contain duplicates.`);
    }
  }
  return sorted;
}

function normalizeSchemaReference(
  reference: TWidgetCapsuleSchemaReference,
): TWidgetCapsuleSchemaReference {
  return {
    format: 'capsule-schema-v1',
    hash: reference.hash,
  };
}

export function fnNormalizeWidgetCapsuleTarget(
  target: TWidgetCapsuleTarget,
): TWidgetCapsuleTarget {
  return {
    runtimeAbi: target.runtimeAbi,
    domProfile: target.domProfile,
    featureProfiles: sortedUnique(target.featureProfiles, 'Capsule feature profiles'),
  };
}

export function fnNormalizeWidgetCapsuleBudgetRequest(
  budgets: TWidgetCapsuleBudgetRequest,
): TWidgetCapsuleBudgetRequest {
  return {
    ...(budgets.cpuMs === undefined ? {} : { cpuMs: budgets.cpuMs }),
    ...(budgets.memoryBytes === undefined ? {} : { memoryBytes: budgets.memoryBytes }),
    ...(budgets.domNodes === undefined ? {} : { domNodes: budgets.domNodes }),
    ...(budgets.handles === undefined ? {} : { handles: budgets.handles }),
    ...(budgets.messageBytes === undefined ? {} : { messageBytes: budgets.messageBytes }),
    ...(budgets.streamBytes === undefined ? {} : { streamBytes: budgets.streamBytes }),
    ...(budgets.assetBytes === undefined ? {} : { assetBytes: budgets.assetBytes }),
    ...(budgets.networkBytes === undefined ? {} : { networkBytes: budgets.networkBytes }),
    ...(budgets.gpuBytes === undefined ? {} : { gpuBytes: budgets.gpuBytes }),
    ...(budgets.lifecycleBytes === undefined
      ? {}
      : { lifecycleBytes: budgets.lifecycleBytes }),
  };
}

export function fnNormalizeWidgetCapsuleBudgets(
  budgets: TWidgetCapsuleBudgets,
): TWidgetCapsuleBudgets {
  return {
    cpuMs: budgets.cpuMs,
    memoryBytes: budgets.memoryBytes,
    domNodes: budgets.domNodes,
    handles: budgets.handles,
    messageBytes: budgets.messageBytes,
    streamBytes: budgets.streamBytes,
    assetBytes: budgets.assetBytes,
    networkBytes: budgets.networkBytes,
    gpuBytes: budgets.gpuBytes,
    lifecycleBytes: budgets.lifecycleBytes,
  };
}

export function fnNormalizeWidgetCapsuleCapabilityRequests(
  requests: readonly TWidgetCapsuleCapabilityRequest[],
): readonly TWidgetCapsuleCapabilityRequest[] {
  const normalized = requests.map((request) => ({
    id: request.id,
    versionRange: request.versionRange,
    contractHash: request.contractHash,
    required: request.required,
    operations: sortedUnique(
      request.operations,
      `Capsule capability '${request.id}' operations`,
    ),
  })).sort((left, right) => compareText(left.id, right.id));

  for (let index = 1; index < normalized.length; index += 1) {
    if (normalized[index - 1]?.id === normalized[index]?.id) {
      throw new TypeError('Capsule capability requests must use unique IDs.');
    }
  }
  return normalized;
}

export function fnNormalizeWidgetCapsuleChannelContract(
  channels: TWidgetCapsuleChannelContract | null,
): TWidgetCapsuleChannelContract | null {
  if (channels === null) return null;
  return {
    format: 'capsule-guest-channels-v1',
    ...(channels.lifecycle === true ? { lifecycle: true as const } : {}),
    ...(channels.props === undefined
      ? {}
      : { props: normalizeSchemaReference(channels.props) }),
    ...(channels.theme === undefined
      ? {}
      : { theme: normalizeSchemaReference(channels.theme) }),
    ...(channels.output === undefined
      ? {}
      : { output: normalizeSchemaReference(channels.output) }),
    ...(channels.store === undefined
      ? {}
      : {
          store: {
            schema: normalizeSchemaReference(channels.store.schema),
            maxEntries: channels.store.maxEntries,
          },
        }),
  };
}

export function fnNormalizeWidgetCapsuleRuntimeDescriptor(
  descriptor: TWidgetCapsuleRuntimeDescriptor,
): TWidgetCapsuleRuntimeDescriptor {
  return {
    format: 'vibecanvas.capsule-runtime.v1',
    capsuleArtifactHash: descriptor.capsuleArtifactHash,
    target: fnNormalizeWidgetCapsuleTarget(descriptor.target),
    budgets: fnNormalizeWidgetCapsuleBudgets(descriptor.budgets),
    capabilityRequests: fnNormalizeWidgetCapsuleCapabilityRequests(
      descriptor.capabilityRequests,
    ),
    channels: fnNormalizeWidgetCapsuleChannelContract(descriptor.channels),
    parkability: { parkable: false },
    signatureKeyIds: sortedUnique(
      descriptor.signatureKeyIds,
      'Capsule signature key IDs',
    ),
  };
}

export function fnCanonicalizeWidgetCapsuleCapabilityRequests(
  requests: readonly TWidgetCapsuleCapabilityRequest[],
): string {
  return JSON.stringify({
    format: 'vibecanvas.capsule-capability-contract.v1',
    requests: fnNormalizeWidgetCapsuleCapabilityRequests(requests),
  });
}

export function fnCanonicalizeWidgetCapsuleChannelContract(
  channels: TWidgetCapsuleChannelContract | null,
): string {
  return JSON.stringify({
    format: 'vibecanvas.capsule-channel-contract.v1',
    channels: fnNormalizeWidgetCapsuleChannelContract(channels),
  });
}

export function fnCanonicalizeWidgetCapsuleRuntimeDescriptor(
  descriptor: TWidgetCapsuleRuntimeDescriptor,
): string {
  return JSON.stringify(fnNormalizeWidgetCapsuleRuntimeDescriptor(descriptor));
}
