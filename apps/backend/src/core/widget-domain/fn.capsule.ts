/**
 * @file Pure normalization for Capsule metadata copied into widget contracts.
 */

import type {
  TWidgetCapsuleBudgetRequest,
  TWidgetCapsuleApiContract,
  TWidgetCapsuleApiGroup,
  TWidgetCapsuleCapabilityRequest,
  TWidgetCapsuleChannelContract,
  TWidgetCapsuleRuntimeDescriptor,
  TWidgetCapsuleSchemaReference,
} from './types';
import { WIDGET_CAPSULE_API_GROUPS } from './CONSTANTS';

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

export function fnNormalizeWidgetCapsuleApis(
  apis: readonly TWidgetCapsuleApiGroup[],
): readonly TWidgetCapsuleApiGroup[] {
  const selected = new Set(apis);
  if (selected.size !== apis.length) {
    throw new TypeError('Capsule API groups must not contain duplicates.');
  }
  if (!selected.has('DOM')) {
    throw new TypeError('Capsule API groups must explicitly include DOM.');
  }
  const renderingGroups = ['CANVAS_2D', 'WEBGL', 'WEBGPU']
    .filter((api) => selected.has(api as TWidgetCapsuleApiGroup));
  if (renderingGroups.length > 1) {
    throw new TypeError('CANVAS_2D, WEBGL, and WEBGPU are mutually exclusive.');
  }
  return WIDGET_CAPSULE_API_GROUPS.filter((api) => selected.has(api));
}

export function fnNormalizeWidgetCapsuleApiContract(
  contract: TWidgetCapsuleApiContract,
): TWidgetCapsuleApiContract {
  return {
    format: 'capsule-api-groups-v1',
    groups: fnNormalizeWidgetCapsuleApis(contract.groups),
    bundleDigest: contract.bundleDigest,
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

function normalizeRuntimeDescriptorTail(
  descriptor: TWidgetCapsuleRuntimeDescriptor,
) {
  return {
    capabilityRequests: fnNormalizeWidgetCapsuleCapabilityRequests(
      descriptor.capabilityRequests,
    ),
    channels: fnNormalizeWidgetCapsuleChannelContract(descriptor.channels),
    parkability: { parkable: false as const },
    signatureKeyIds: sortedUnique(
      descriptor.signatureKeyIds,
      'Capsule signature key IDs',
    ),
  };
}

export function fnNormalizeWidgetCapsuleRuntimeDescriptor(
  descriptor: TWidgetCapsuleRuntimeDescriptor,
): TWidgetCapsuleRuntimeDescriptor {
  return {
    format: 'omnidraw.capsule-runtime.v2',
    capsuleArtifactHash: descriptor.capsuleArtifactHash,
    apiContract: fnNormalizeWidgetCapsuleApiContract(descriptor.apiContract),
    budgets: fnNormalizeWidgetCapsuleBudgetRequest(descriptor.budgets),
    ...normalizeRuntimeDescriptorTail(descriptor),
  };
}

export function fnCanonicalizeWidgetCapsuleCapabilityRequests(
  requests: readonly TWidgetCapsuleCapabilityRequest[],
): string {
  return JSON.stringify({
    format: 'omnidraw.capsule-capability-contract.v1',
    requests: fnNormalizeWidgetCapsuleCapabilityRequests(requests),
  });
}

export function fnCanonicalizeWidgetCapsuleChannelContract(
  channels: TWidgetCapsuleChannelContract | null,
): string {
  return JSON.stringify({
    format: 'omnidraw.capsule-channel-contract.v1',
    channels: fnNormalizeWidgetCapsuleChannelContract(channels),
  });
}

export function fnCanonicalizeWidgetCapsuleRuntimeDescriptor(
  descriptor: TWidgetCapsuleRuntimeDescriptor,
): string {
  return JSON.stringify(fnNormalizeWidgetCapsuleRuntimeDescriptor(descriptor));
}
