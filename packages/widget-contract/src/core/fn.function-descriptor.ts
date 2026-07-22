/**
 * @file Pure normalization, canonicalization, and manifest ceiling checks for
 * generated short-lived server-function descriptors.
 */

import type {
  TWidgetManifestV2,
  TWidgetSerializableJsonObject,
  TWidgetSerializableJsonValue,
  TWidgetServerFunctionDescriptor,
  TWidgetServerFunctionDescriptorValidation,
  TWidgetServerFunctionResourceAccess,
} from '../types';

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
    ...(descriptor.modulePath === undefined ? {} : { modulePath: descriptor.modulePath }),
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
    retry: {
      mode: descriptor.retry.mode,
      maxAttempts: descriptor.retry.maxAttempts,
      initialBackoffMs: descriptor.retry.initialBackoffMs,
      maxBackoffMs: descriptor.retry.maxBackoffMs,
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
    format: 'vibecanvas.server-functions.v1',
    functions: fnNormalizeWidgetServerFunctionDescriptors(descriptors),
  });
}

export function fnValidateWidgetServerFunctionDescriptors(
  manifest: TWidgetManifestV2,
  descriptors: readonly TWidgetServerFunctionDescriptor[],
): TWidgetServerFunctionDescriptorValidation {
  if (manifest.server === undefined) {
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
    if (descriptor.modulePath === undefined) {
      return {
        valid: false,
        reason: 'missing_module_path',
        exportName: descriptor.exportName,
      };
    }
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
