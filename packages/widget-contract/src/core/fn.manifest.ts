/**
 * @file Pure normalization and invariant checks for widget manifest v3.
 */

import type {
  TResourceNamedOperation,
  TResourceOperationParameterDeclaration,
  TResourceRequirement,
} from '@omnidraw/resource-runtime';
import type { TWidgetManifestV3 } from '../types';
import {
  fnNormalizeWidgetCapsuleBudgetRequest,
  fnNormalizeWidgetCapsuleApis,
} from './fn.capsule';

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizeParameterDeclarations(
  parameters: Readonly<Record<string, TResourceOperationParameterDeclaration>> | undefined,
): Readonly<Record<string, TResourceOperationParameterDeclaration>> | undefined {
  if (parameters === undefined) return undefined;

  return Object.fromEntries(
    Object.entries(parameters)
      .sort(([left], [right]) => compareText(left, right))
      .map(([name, declaration]) => [name, {
        type: declaration.type,
        ...(declaration.required === undefined ? {} : { required: declaration.required }),
        ...(declaration.nullable === undefined ? {} : { nullable: declaration.nullable }),
      }]),
  );
}

function normalizeOperations(
  operations: Readonly<Record<string, TResourceNamedOperation>> | undefined,
): Readonly<Record<string, TResourceNamedOperation>> | undefined {
  if (operations === undefined) return undefined;

  return Object.fromEntries(
    Object.entries(operations)
      .sort(([left], [right]) => compareText(left, right))
      .map(([name, operation]) => [name, {
        effect: operation.effect,
        sql: operation.sql,
        ...(operation.parameters === undefined
          ? {}
          : { parameters: normalizeParameterDeclarations(operation.parameters) }),
        result: operation.result,
      }]),
  );
}

function normalizeRequirement(requirement: TResourceRequirement): TResourceRequirement {
  return {
    slot: requirement.slot,
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

export function fnNormalizeWidgetRelativePath(value: string): string | null {
  if (value.length === 0 || value.length > 512 || value !== value.trim()) return null;
  if (value.includes('\\') || value.includes('\0') || value.startsWith('/')) return null;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) return null;

  let normalized = value;
  while (normalized.startsWith('./')) normalized = normalized.slice(2);
  if (normalized.length === 0) return null;

  const segments = normalized.split('/');
  if (segments.some((segment) => (
    segment.length === 0
    || segment.length > 255
    || segment === '.'
    || segment === '..'
  ))) return null;

  return segments.join('/');
}

export function fnNormalizeWidgetManifest(manifest: TWidgetManifestV3): TWidgetManifestV3 {
  const uiEntry = fnNormalizeWidgetRelativePath(manifest.ui.entry) ?? manifest.ui.entry;
  const serverEntry = manifest.server === undefined
    ? undefined
    : fnNormalizeWidgetRelativePath(manifest.server.entry) ?? manifest.server.entry;
  const resources = manifest.resources === undefined
    ? undefined
    : [...manifest.resources]
      .sort((left, right) => compareText(left.slot, right.slot))
      .map(normalizeRequirement);

  return {
    schemaVersion: 3,
    name: manifest.name.trim(),
    slug: manifest.slug,
    ...(manifest.description === undefined
      ? {}
      : { description: manifest.description.trim() }),
    ui: {
      runtime: 'capsule',
      entry: uiEntry,
      apis: fnNormalizeWidgetCapsuleApis(manifest.ui.apis),
      ...(manifest.ui.budgets === undefined
        ? {}
        : { budgets: fnNormalizeWidgetCapsuleBudgetRequest(manifest.ui.budgets) }),
      ...(manifest.ui.state === undefined
        ? {}
        : {
            state: {
              collaborative: manifest.ui.state.collaborative,
              localStore: manifest.ui.state.localStore,
            },
          }),
      ...(manifest.ui.parkability === undefined
        ? {}
        : { parkability: { enabled: false as const } }),
    },
    ...(manifest.server === undefined
      ? {}
      : { server: { entry: serverEntry!, runtimeAbi: manifest.server.runtimeAbi } }),
    ...(resources === undefined ? {} : { resources }),
  };
}

export function fnCanonicalizeWidgetManifest(manifest: TWidgetManifestV3): string {
  return JSON.stringify(fnNormalizeWidgetManifest(manifest));
}
