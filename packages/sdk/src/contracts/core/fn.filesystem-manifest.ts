/** @file Pure manifest-v1 normalization, projection, and manifest digest rules. */

import type {
  TResourceNamedOperation,
  TResourceOperationParameterDeclaration,
  TResourceRequirement,
} from '../types';
import type {
  TWidgetExecutableManifestProjection,
  TWidgetManifestV1,
  TWidgetPresentationProjection,
} from '../filesystem/typed';
import type { TOmnidrawToolIcon } from '../types';
import {
  fnNormalizeWidgetRuntimeApis,
  fnNormalizeWidgetRuntimeBudgetRequest,
} from './fn.capsule';
import {
  fnNormalizeWidgetFilesystemRelativePath,
} from './fn.filesystem-path';

const SHA256_PATTERN = /^[0-9a-f]{64}$/;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizeParameterDeclarations(
  parameters: Readonly<Record<string, TResourceOperationParameterDeclaration>> | undefined,
): Readonly<Record<string, TResourceOperationParameterDeclaration>> | undefined {
  if (parameters === undefined) return undefined;
  return Object.fromEntries(Object.entries(parameters)
    .sort(([left], [right]) => compareText(left, right))
    .map(([name, declaration]) => [name, {
      type: declaration.type,
      ...(declaration.required === undefined ? {} : { required: declaration.required }),
      ...(declaration.nullable === undefined ? {} : { nullable: declaration.nullable }),
    }]));
}

function normalizeOperations(
  operations: Readonly<Record<string, TResourceNamedOperation>> | undefined,
): Readonly<Record<string, TResourceNamedOperation>> | undefined {
  if (operations === undefined) return undefined;
  return Object.fromEntries(Object.entries(operations)
    .sort(([left], [right]) => compareText(left, right))
    .map(([name, operation]) => [name, {
      effect: operation.effect,
      sql: operation.sql,
      ...(operation.parameters === undefined
        ? {}
        : { parameters: normalizeParameterDeclarations(operation.parameters) }),
      result: operation.result,
    }]));
}

function normalizeRequirement(requirement: TResourceRequirement): TResourceRequirement {
  return {
    slot: requirement.slot,
    ...(requirement.resourceId === undefined ? {} : { resourceId: requirement.resourceId }),
    kind: requirement.kind,
    effect: requirement.effect,
    ...(requirement.required === undefined ? {} : { required: requirement.required }),
    ...(requirement.arbitrarySql === undefined
      ? {}
      : { arbitrarySql: requirement.arbitrarySql }),
    ...(requirement.operations === undefined
      ? {}
      : { operations: normalizeOperations(requirement.operations) }),
  };
}

function normalizeExecutableRequirement(
  requirement: TResourceRequirement,
): Omit<TResourceRequirement, 'resourceId'> {
  const normalized = normalizeRequirement(requirement);
  const { resourceId: _resourceId, ...executable } = normalized;
  return executable;
}

function normalizeIcon(icon: TOmnidrawToolIcon | undefined): TOmnidrawToolIcon | undefined {
  if (icon === undefined) return undefined;
  return {
    ...(icon.lucidIcon === undefined ? {} : { lucidIcon: icon.lucidIcon }),
    ...(icon.svgIcon === undefined ? {} : { svgIcon: icon.svgIcon }),
  };
}

function assertDigest(value: string, field: string): void {
  if (!SHA256_PATTERN.test(value)) throw new TypeError(`${field} must be a lowercase SHA-256 digest.`);
}

export function fnNormalizeWidgetManifestV1(manifest: TWidgetManifestV1): TWidgetManifestV1 {
  const resources = [...(manifest.resources ?? [])]
    .sort((left, right) => compareText(left.slot, right.slot))
    .map(normalizeRequirement);
  return {
    $schema: 'https://omnidraw.dev/schemas/widget/v1.json',
    schemaVersion: 1,
    name: manifest.name.trim(),
    slug: manifest.slug,
    description: manifest.description.trim(),
    tool: {
      label: manifest.tool.label.trim(),
      ...(manifest.tool.icon === undefined ? {} : { icon: normalizeIcon(manifest.tool.icon)! }),
      group: manifest.tool.group,
      priority: manifest.tool.priority,
    },
    ui: {
      runtime: 'capsule',
      entry: fnNormalizeWidgetFilesystemRelativePath(manifest.ui.entry) ?? manifest.ui.entry,
      apis: fnNormalizeWidgetRuntimeApis(manifest.ui.apis),
      ...(manifest.ui.budgets === undefined
        ? {}
        : { budgets: fnNormalizeWidgetRuntimeBudgetRequest(manifest.ui.budgets) }),
      ...(manifest.ui.state === undefined
        ? {}
        : { state: {
            collaborative: manifest.ui.state.collaborative,
            localStore: manifest.ui.state.localStore,
          } }),
      ...(manifest.ui.parkability === undefined
        ? {}
        : { parkability: { enabled: false as const } }),
    },
    ...(manifest.server === undefined
      ? {}
      : { server: {
          entry: fnNormalizeWidgetFilesystemRelativePath(manifest.server.entry)
            ?? manifest.server.entry,
          runtimeAbi: manifest.server.runtimeAbi,
        } }),
    ...(resources.length === 0 ? {} : { resources }),
  };
}

export function fnProjectWidgetPresentation(
  manifest: TWidgetManifestV1,
): TWidgetPresentationProjection {
  const normalized = fnNormalizeWidgetManifestV1(manifest);
  return {
    $schema: normalized.$schema,
    name: normalized.name,
    description: normalized.description,
    tool: {
      label: normalized.tool.label,
      icon: normalized.tool.icon ?? null,
      group: normalized.tool.group,
      priority: normalized.tool.priority,
    },
  };
}

export function fnProjectWidgetExecutableManifest(
  manifest: TWidgetManifestV1,
): TWidgetExecutableManifestProjection {
  const normalized = fnNormalizeWidgetManifestV1(manifest);
  return {
    schemaVersion: 1,
    ui: normalized.ui,
    server: normalized.server ?? null,
    resources: (normalized.resources ?? []).map(normalizeExecutableRequirement),
  };
}

export function fnCanonicalizeWidgetManifestV1(manifest: TWidgetManifestV1): string {
  return JSON.stringify(fnNormalizeWidgetManifestV1(manifest));
}

export function fnCanonicalizeWidgetPresentation(manifest: TWidgetManifestV1): string {
  return JSON.stringify(fnProjectWidgetPresentation(manifest));
}

export function fnCanonicalizeWidgetExecutableManifest(manifest: TWidgetManifestV1): string {
  return JSON.stringify(fnProjectWidgetExecutableManifest(manifest));
}

export function fnNormalizeWidgetExecutableProjection(
  projection: TWidgetExecutableManifestProjection,
): TWidgetExecutableManifestProjection {
  return {
    schemaVersion: 1,
    ui: {
      runtime: 'capsule',
      entry: fnNormalizeWidgetFilesystemRelativePath(projection.ui.entry) ?? projection.ui.entry,
      apis: fnNormalizeWidgetRuntimeApis(projection.ui.apis),
      ...(projection.ui.budgets === undefined
        ? {}
        : { budgets: fnNormalizeWidgetRuntimeBudgetRequest(projection.ui.budgets) }),
      ...(projection.ui.state === undefined
        ? {}
        : { state: {
            collaborative: projection.ui.state.collaborative,
            localStore: projection.ui.state.localStore,
          } }),
      ...(projection.ui.parkability === undefined
        ? {}
        : { parkability: { enabled: false as const } }),
    },
    server: projection.server === null
      ? null
      : {
          entry: fnNormalizeWidgetFilesystemRelativePath(projection.server.entry)
            ?? projection.server.entry,
          runtimeAbi: projection.server.runtimeAbi,
        },
    resources: [...projection.resources]
      .sort((left, right) => compareText(left.slot, right.slot))
      .map(normalizeExecutableRequirement),
  };
}

export function fnCanonicalizeWidgetExecutableProjection(
  projection: TWidgetExecutableManifestProjection,
): string {
  return JSON.stringify(fnNormalizeWidgetExecutableProjection(projection));
}

export function fnWidgetManifestV1Digest(args: Readonly<{
  manifest: TWidgetManifestV1;
  digestSha256(value: string): string;
}>): string {
  const digest = args.digestSha256(fnCanonicalizeWidgetManifestV1(args.manifest));
  assertDigest(digest, 'Manifest digest');
  return digest;
}

export function fnWidgetExecutableManifestDigest(args: Readonly<{
  manifest: TWidgetManifestV1;
  digestSha256(value: string): string;
}>): string {
  const digest = args.digestSha256(fnCanonicalizeWidgetExecutableManifest(args.manifest));
  assertDigest(digest, 'Executable manifest digest');
  return digest;
}
