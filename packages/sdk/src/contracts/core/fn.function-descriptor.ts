/**
 * @file Pure normalization, canonicalization, and manifest ceiling checks for
 * generated short-lived server-function descriptors.
 */

import type {
  TWidgetCapabilityRequest,
  TWidgetSerializableJsonObject,
  TWidgetSerializableJsonValue,
  TWidgetServerFunctionDescriptor,
  TWidgetServerFunctionDescriptorValidation,
  TWidgetServerFunctionResourceAccess,
} from '../types';
import type { TWidgetExecutableManifestProjection, TWidgetManifestV1 } from '../filesystem/typed';

const SERVER_FUNCTION_CAPABILITY_ID_NAMESPACE = 'omnidraw.widget.functions.';
const SERVER_FUNCTION_CAPABILITY_ID_PREFIX = `${SERVER_FUNCTION_CAPABILITY_ID_NAMESPACE}h`;
const SERVER_FUNCTION_CAPABILITY_VERSION = '1.0.0';

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizeJson(value: TWidgetSerializableJsonValue): TWidgetSerializableJsonValue {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(normalizeJson);

  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => compareText(left, right))
      .map(([key, nested]) => [key, normalizeJson(nested)]),
  );
}

function normalizeResources(
  resources: readonly TWidgetServerFunctionResourceAccess[],
): readonly TWidgetServerFunctionResourceAccess[] {
  return [...resources]
    .sort((left, right) => compareText(left.slot, right.slot))
    .map((resource) => ({ slot: resource.slot, effect: resource.effect }));
}

export function fnNormalizeWidgetServerFunctionDescriptor(
  descriptor: TWidgetServerFunctionDescriptor,
): TWidgetServerFunctionDescriptor {
  return {
    schemaVersion: 1,
    exportName: descriptor.exportName,
    effect: descriptor.effect,
    inputSchema: normalizeJson(descriptor.inputSchema) as TWidgetSerializableJsonObject,
    outputSchema: normalizeJson(descriptor.outputSchema) as TWidgetSerializableJsonObject,
    resources: normalizeResources(descriptor.resources),
    limits: {
      timeoutMs: descriptor.limits.timeoutMs,
      memoryTier: descriptor.limits.memoryTier,
      outputByteLimit: descriptor.limits.outputByteLimit,
      logByteLimit: descriptor.limits.logByteLimit,
    },
  };
}

export function fnNormalizeWidgetServerFunctionDescriptors(
  descriptors: readonly TWidgetServerFunctionDescriptor[],
): readonly TWidgetServerFunctionDescriptor[] {
  return [...descriptors]
    .sort((left, right) => compareText(left.exportName, right.exportName))
    .map(fnNormalizeWidgetServerFunctionDescriptor);
}

export function fnCanonicalizeWidgetServerFunctionDescriptors(
  descriptors: readonly TWidgetServerFunctionDescriptor[],
): string {
  return JSON.stringify({
    format: 'omnidraw.server-functions.v1',
    functions: fnNormalizeWidgetServerFunctionDescriptors(descriptors),
  });
}

export function fnWidgetServerFunctionCapabilityRequestMatches(
  descriptorDigestSha256: string,
  descriptors: readonly TWidgetServerFunctionDescriptor[],
  requests: readonly TWidgetCapabilityRequest[],
): boolean {
  const functionRequests = requests.filter((request) => (
    request.id.startsWith(SERVER_FUNCTION_CAPABILITY_ID_NAMESPACE)
  ));
  if (descriptors.length === 0) return functionRequests.length === 0;
  if (!/^[0-9a-f]{64}$/.test(descriptorDigestSha256) || functionRequests.length !== 1) {
    return false;
  }

  const request = functionRequests[0]!;
  const expectedOperations = descriptors
    .map((descriptor) => descriptor.exportName)
    .sort(compareText);
  const actualOperations = [...request.operations].sort(compareText);
  return request.id === `${SERVER_FUNCTION_CAPABILITY_ID_PREFIX}${descriptorDigestSha256}`
    && request.versionRange === SERVER_FUNCTION_CAPABILITY_VERSION
    && request.contractHash === `sha256:${descriptorDigestSha256}`
    && request.required
    && expectedOperations.length === actualOperations.length
    && expectedOperations.every((operation, index) => operation === actualOperations[index]);
}

/**
 * Client-side twin of `fnWidgetServerFunctionCapabilityRequestMatches`.
 * The browser receives the same path-free canonical descriptors, so this
 * checks only what the client can verify:
 * the signed selector is self-consistent and its operations/version/required
 * fields match the canonical path-free descriptors. The server-digest binding
 * of `contractHash` stays a host-side check.
 */
export function fnWidgetBrowserFunctionCapabilityRequestMatches(
  request: TWidgetCapabilityRequest,
  descriptors: readonly TWidgetServerFunctionDescriptor[],
): boolean {
  const idMatch = /^omnidraw\.widget\.functions\.h([0-9a-f]{64})$/.exec(request.id);
  if (idMatch === null) return false;
  const expectedOperations = descriptors
    .map((descriptor) => descriptor.exportName)
    .sort(compareText);
  const actualOperations = [...request.operations].sort(compareText);
  return request.contractHash === `sha256:${idMatch[1]!}`
    && request.versionRange === SERVER_FUNCTION_CAPABILITY_VERSION
    && request.required
    && expectedOperations.length === actualOperations.length
    && expectedOperations.every((operation, index) => operation === actualOperations[index]);
}

export function fnValidateWidgetServerFunctionDescriptors(
  manifest: TWidgetManifestV1 | TWidgetExecutableManifestProjection,
  descriptors: readonly TWidgetServerFunctionDescriptor[],
): TWidgetServerFunctionDescriptorValidation {
  if (manifest.server === undefined || manifest.server === null) {
    return descriptors.length === 0
      ? { valid: true }
      : { valid: false, reason: 'browser_only_has_functions' };
  }
  if (descriptors.length === 0) return { valid: false, reason: 'server_has_no_functions' };

  const exports = new Set<string>();
  const requirements = new Map((manifest.resources ?? []).map((requirement) => [
    requirement.slot,
    requirement,
  ]));
  for (const descriptor of descriptors) {
    if (exports.has(descriptor.exportName)) {
      return {
        valid: false,
        reason: 'duplicate_export',
        exportName: descriptor.exportName,
      };
    }
    exports.add(descriptor.exportName);

    const slots = new Set<string>();
    for (const resource of descriptor.resources) {
      if (slots.has(resource.slot)) {
        return {
          valid: false,
          reason: 'duplicate_resource_slot',
          exportName: descriptor.exportName,
          slot: resource.slot,
        };
      }
      slots.add(resource.slot);

      if (descriptor.effect === 'fn') {
        return {
          valid: false,
          reason: 'fn_has_resources',
          exportName: descriptor.exportName,
          slot: resource.slot,
        };
      }
      if (descriptor.effect === 'fx' && resource.effect !== 'read') {
        return {
          valid: false,
          reason: 'fx_has_write_resource',
          exportName: descriptor.exportName,
          slot: resource.slot,
        };
      }

      const requirement = requirements.get(resource.slot);
      if (requirement === undefined) {
        return {
          valid: false,
          reason: 'unknown_resource_slot',
          exportName: descriptor.exportName,
          slot: resource.slot,
        };
      }
      const allowsRead = requirement.effect === 'read' || requirement.effect === 'read_write';
      const allowsWrite = requirement.effect === 'write' || requirement.effect === 'read_write';
      const requestsRead = resource.effect === 'read' || resource.effect === 'read_write';
      const requestsWrite = resource.effect === 'write' || resource.effect === 'read_write';
      if ((requestsRead && !allowsRead) || (requestsWrite && !allowsWrite)) {
        return {
          valid: false,
          reason: 'resource_effect_exceeded',
          exportName: descriptor.exportName,
          slot: resource.slot,
        };
      }
    }
  }

  return { valid: true };
}
