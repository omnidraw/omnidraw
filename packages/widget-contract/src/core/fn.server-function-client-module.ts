/** @file Pure generation of a browser-only virtual module for discovered server exports. */

import type { TWidgetServerFunctionDescriptor } from '../types';

const EXPORT_NAME_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]{0,127}$/;
const CAPSULE_HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;
const FUNCTION_CAPABILITY_ID_PATTERN =
  /^omnidraw\.widget\.functions\.h[0-9a-f]{64}$/;

export function fnGenerateWidgetServerFunctionClientModule(
  args: Readonly<{
    descriptors: readonly TWidgetServerFunctionDescriptor[];
    serverModuleSpecifier: string;
    capabilitySelector: Readonly<{
      id: string;
      versionRange: string;
      contractHash: `sha256:${string}`;
    }>;
    includeTypeBindings?: boolean;
  }>,
): string {
  if (
    !args.serverModuleSpecifier.startsWith('.')
    || args.serverModuleSpecifier.includes('\\')
    || args.serverModuleSpecifier.includes('\0')
    || args.serverModuleSpecifier.includes('\n')
    || args.serverModuleSpecifier.includes('\r')
  ) throw new Error('Generated client type source requires a safe relative server module specifier.');
  if (
    !FUNCTION_CAPABILITY_ID_PATTERN.test(args.capabilitySelector.id)
    || args.capabilitySelector.versionRange !== '1.0.0'
    || !CAPSULE_HASH_PATTERN.test(args.capabilitySelector.contractHash)
  ) {
    throw new Error('Generated client source requires a valid trusted Capsule selector.');
  }

  const names = [...args.descriptors]
    .map((descriptor) => descriptor.exportName)
    .sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
  const seen = new Set<string>();
  for (const name of names) {
    if (!EXPORT_NAME_PATTERN.test(name) || seen.has(name)) {
      throw new Error('Cannot generate a client module for invalid or duplicate exports.');
    }
    seen.add(name);
  }

  const includeTypes = args.includeTypeBindings !== false;
  const selector = JSON.stringify(args.capabilitySelector);
  return [
    'import { createServerFunctionProxy as __omnidrawCreateProxy } from "@omnidraw/sdk/function-client";',
    ...(includeTypes
      ? ['import type { TServerFunctionClientOf as __OmnidrawClientOf } from "@omnidraw/sdk/function-client";']
      : []),
    ...names.map((name) => (
      includeTypes
        ? `export const ${name}: __OmnidrawClientOf<typeof import(${JSON.stringify(args.serverModuleSpecifier)})[${JSON.stringify(name)}]> = __omnidrawCreateProxy(${JSON.stringify(name)}, ${selector});`
        : `export const ${name} = __omnidrawCreateProxy(${JSON.stringify(name)}, ${selector});`
    )),
    '',
  ].join('\n');
}
