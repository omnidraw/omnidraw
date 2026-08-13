/**
 * @file Pure normalization for Capsule metadata copied into widget contracts.
 */

import type {
  TWidgetRuntimeBudgetRequest,
  TWidgetRuntimeApiContract,
  TWidgetRuntimeApiGroup,
  TWidgetCapabilityRequest,
  TWidgetChannelContract,
  TWidgetRuntimeDescriptor,
  TWidgetSchemaReference,
} from '../types';
import { WIDGET_RUNTIME_API_GROUPS } from '../CONSTANTS';

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
  reference: TWidgetSchemaReference,
): TWidgetSchemaReference {
  return {
    format: 'capsule-schema-v1',
    hash: reference.hash,
  };
}

export function fnNormalizeWidgetRuntimeApis(
  apis: readonly TWidgetRuntimeApiGroup[],
): readonly TWidgetRuntimeApiGroup[] {
  const selected = new Set(apis);
  if (selected.size !== apis.length) {
    throw new TypeError('Capsule API groups must not contain duplicates.');
  }
  if (!selected.has('DOM')) {
    throw new TypeError('Capsule API groups must explicitly include DOM.');
  }
  const renderingGroups = ['CANVAS_2D', 'WEBGL', 'WEBGPU']
    .filter((api) => selected.has(api as TWidgetRuntimeApiGroup));
  if (renderingGroups.length > 1) {
    throw new TypeError('CANVAS_2D, WEBGL, and WEBGPU are mutually exclusive.');
  }
  return WIDGET_RUNTIME_API_GROUPS.filter((api) => selected.has(api));
}

export function fnNormalizeWidgetRuntimeApiContract(
  contract: TWidgetRuntimeApiContract,
): TWidgetRuntimeApiContract {
  return {
    format: 'capsule-api-groups-v1',
    groups: fnNormalizeWidgetRuntimeApis(contract.groups),
    bundleDigest: contract.bundleDigest,
  };
}

export function fnNormalizeWidgetRuntimeBudgetRequest(
  budgets: TWidgetRuntimeBudgetRequest,
): TWidgetRuntimeBudgetRequest {
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

export function fnNormalizeWidgetCapabilityRequests(
  requests: readonly TWidgetCapabilityRequest[],
): readonly TWidgetCapabilityRequest[] {
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

export function fnNormalizeWidgetChannelContract(
  channels: TWidgetChannelContract | null,
): TWidgetChannelContract | null {
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
  descriptor: TWidgetRuntimeDescriptor,
) {
  return {
    capabilityRequests: fnNormalizeWidgetCapabilityRequests(
      descriptor.capabilityRequests,
    ),
    channels: fnNormalizeWidgetChannelContract(descriptor.channels),
    parkability: { parkable: false as const },
    signatureKeyIds: sortedUnique(
      descriptor.signatureKeyIds,
      'Capsule signature key IDs',
    ),
  };
}

export function fnNormalizeWidgetRuntimeDescriptor(
  descriptor: TWidgetRuntimeDescriptor,
): TWidgetRuntimeDescriptor {
  return {
    format: 'omnidraw.capsule-runtime.v2',
    artifactHash: descriptor.artifactHash,
    apiContract: fnNormalizeWidgetRuntimeApiContract(descriptor.apiContract),
    budgets: fnNormalizeWidgetRuntimeBudgetRequest(descriptor.budgets),
    ...normalizeRuntimeDescriptorTail(descriptor),
  };
}

export function fnCanonicalizeWidgetCapabilityRequests(
  requests: readonly TWidgetCapabilityRequest[],
): string {
  return JSON.stringify({
    format: 'omnidraw.capsule-capability-contract.v1',
    requests: fnNormalizeWidgetCapabilityRequests(requests),
  });
}

export function fnCanonicalizeWidgetChannelContract(
  channels: TWidgetChannelContract | null,
): string {
  return JSON.stringify({
    format: 'omnidraw.capsule-channel-contract.v1',
    channels: fnNormalizeWidgetChannelContract(channels),
  });
}

export function fnCanonicalizeWidgetRuntimeDescriptor(
  descriptor: TWidgetRuntimeDescriptor,
): string {
  return JSON.stringify(fnNormalizeWidgetRuntimeDescriptor(descriptor));
}
