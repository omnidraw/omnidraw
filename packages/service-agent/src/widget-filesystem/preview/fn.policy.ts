/** @file Pure bounds, identity, and exact Preview construction reuse policy. */

import type {
  TPreviewConstructionCompatibility,
  TPreviewDiagnostic,
  TPreviewDiagnosticInput,
  TPreviewSelectedResource,
} from './typed';
import {
  PREVIEW_IDENTITY_MAX_LENGTH,
  PREVIEW_RESOURCE_ID_MAX_LENGTH,
  PREVIEW_RESOURCE_SLOT_MAX_LENGTH,
  PREVIEW_SESSION_ID_MAX_LENGTH,
  PREVIEW_WIDGET_KEY_MAX_LENGTH,
} from './CONSTANTS';

const SESSION_ID_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9._-]*[a-zA-Z0-9])?$/;
const WIDGET_KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const CAPSULE_HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;

function normalizedIdentity(value: string, label: string, maxLength: number): string {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maxLength || normalized !== value) {
    throw new TypeError(`${label} must be a bounded, trimmed value.`);
  }
  return normalized;
}

function normalizedCapsuleHash(
  value: `sha256:${string}`,
  label: string,
): `sha256:${string}` {
  const normalized = normalizedIdentity(value, label, PREVIEW_IDENTITY_MAX_LENGTH);
  if (!CAPSULE_HASH_PATTERN.test(normalized)) {
    throw new TypeError(`${label} must be a lowercase Capsule SHA-256 hash.`);
  }
  return normalized as `sha256:${string}`;
}

export function fnNormalizePreviewSessionId(value: string): string {
  const normalized = normalizedIdentity(
    value,
    'Preview session ID',
    PREVIEW_SESSION_ID_MAX_LENGTH,
  );
  if (!SESSION_ID_PATTERN.test(normalized)) {
    throw new TypeError('Preview session ID contains unsafe path characters.');
  }
  return normalized;
}

export function fnNormalizePreviewWidgetKey(value: string): string {
  const normalized = normalizedIdentity(
    value,
    'Preview widget key',
    PREVIEW_WIDGET_KEY_MAX_LENGTH,
  );
  if (!WIDGET_KEY_PATTERN.test(normalized)) {
    throw new TypeError('Preview widget key must be lowercase ASCII kebab-case.');
  }
  return normalized;
}

export function fnNormalizePreviewExecutableInputDigest(value: string): string {
  if (!SHA256_PATTERN.test(value)) {
    throw new TypeError('Preview executable digest must be a lowercase SHA-256 digest.');
  }
  return value;
}

export function fnPreviewTempRelativePath(sessionId: string): string {
  return `.preview/sessions/${fnNormalizePreviewSessionId(sessionId)}`;
}

export function fnNormalizePreviewConstructionCompatibility(
  compatibility: TPreviewConstructionCompatibility,
): TPreviewConstructionCompatibility {
  return Object.freeze({
    builderIdentity: normalizedIdentity(
      compatibility.builderIdentity,
      'Preview builder identity',
      PREVIEW_IDENTITY_MAX_LENGTH,
    ),
    buildPolicyId: normalizedIdentity(
      compatibility.buildPolicyId,
      'Preview build policy ID',
      PREVIEW_IDENTITY_MAX_LENGTH,
    ),
    environmentIdentity: normalizedIdentity(
      compatibility.environmentIdentity,
      'Preview environment identity',
      PREVIEW_IDENTITY_MAX_LENGTH,
    ),
    capsuleBuildIdentity: Object.freeze({
      packageName: compatibility.capsuleBuildIdentity.packageName,
      packageVersion: normalizedIdentity(
        compatibility.capsuleBuildIdentity.packageVersion,
        'Capsule package version',
        PREVIEW_IDENTITY_MAX_LENGTH,
      ),
      packageDigest: normalizedCapsuleHash(
        compatibility.capsuleBuildIdentity.packageDigest,
        'Capsule package digest',
      ),
      buildApiVersion: normalizedIdentity(
        compatibility.capsuleBuildIdentity.buildApiVersion,
        'Capsule build API version',
        PREVIEW_IDENTITY_MAX_LENGTH,
      ),
      runtimeBuildDigest: normalizedCapsuleHash(
        compatibility.capsuleBuildIdentity.runtimeBuildDigest,
        'Capsule runtime build digest',
      ),
    }),
    serverRuntimeAbi: compatibility.serverRuntimeAbi === null
      ? null
      : normalizedIdentity(
        compatibility.serverRuntimeAbi,
        'Preview server runtime ABI',
        PREVIEW_IDENTITY_MAX_LENGTH,
      ),
  });
}

export function fnPreviewConstructionCompatibilityKey(
  compatibility: TPreviewConstructionCompatibility,
): string {
  return JSON.stringify(fnNormalizePreviewConstructionCompatibility(compatibility));
}

export function fnCanReusePreviewConstruction(args: Readonly<{
  candidateExecutableInputDigestSha256: string;
  candidateCompatibility: TPreviewConstructionCompatibility;
  requestedExecutableInputDigestSha256: string;
  requestedCompatibility: TPreviewConstructionCompatibility;
}>): boolean {
  return fnNormalizePreviewExecutableInputDigest(args.candidateExecutableInputDigestSha256)
    === fnNormalizePreviewExecutableInputDigest(args.requestedExecutableInputDigestSha256)
    && fnPreviewConstructionCompatibilityKey(args.candidateCompatibility)
      === fnPreviewConstructionCompatibilityKey(args.requestedCompatibility);
}

export function fnNormalizePreviewSelectedResources(args: Readonly<{
  resources: readonly TPreviewSelectedResource[];
  maximum: number;
}>): readonly TPreviewSelectedResource[] {
  if (args.resources.length > args.maximum) {
    throw new TypeError(`Preview selected resources exceed the ${args.maximum} entry limit.`);
  }
  const slots = new Set<string>();
  return Object.freeze(args.resources.map((resource) => {
    const slot = normalizedIdentity(
      resource.slot,
      'Preview resource slot',
      PREVIEW_RESOURCE_SLOT_MAX_LENGTH,
    );
    const resourceId = normalizedIdentity(
      resource.resourceId,
      'Preview resource ID',
      PREVIEW_RESOURCE_ID_MAX_LENGTH,
    );
    if (resource.effect !== 'read' && resource.effect !== 'read_write') {
      throw new TypeError(`Preview resource '${slot}' has an invalid effect.`);
    }
    if (slots.has(slot)) throw new TypeError(`Duplicate Preview resource slot: ${slot}`);
    slots.add(slot);
    return Object.freeze({ slot, resourceId, effect: resource.effect });
  }));
}

export function fnNormalizePreviewDiagnostic(args: Readonly<{
  diagnostic: TPreviewDiagnosticInput;
  maximumCharacters: number;
}>): TPreviewDiagnostic {
  const message = args.diagnostic.message.slice(0, args.maximumCharacters);
  const code = args.diagnostic.code?.trim().slice(0, 200) || null;
  const path = args.diagnostic.path?.trim().slice(0, 500) || null;
  return Object.freeze({
    severity: args.diagnostic.severity,
    message,
    code,
    path,
  });
}
