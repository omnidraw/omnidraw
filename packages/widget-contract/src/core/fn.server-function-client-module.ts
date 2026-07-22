/** @file Pure generation of a browser-only virtual module for discovered server exports. */

import type { TWidgetServerFunctionDescriptor } from '../types';

const EXPORT_NAME_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]{0,127}$/;

export function fnGenerateWidgetServerFunctionClientModule(
  args: Readonly<{
    descriptors: readonly TWidgetServerFunctionDescriptor[];
    serverModuleSpecifier: string;
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
  return [
    'import { createServerFunctionProxy as __vibecanvasCreateProxy } from "@vibecanvas/sdk/function-client";',
    ...(includeTypes
      ? ['import type { TServerFunctionClientOf as __VibecanvasClientOf } from "@vibecanvas/sdk/function-client";']
      : []),
    ...names.map((name) => (
      includeTypes
        ? `export const ${name}: __VibecanvasClientOf<typeof import(${JSON.stringify(args.serverModuleSpecifier)})[${JSON.stringify(name)}]> = __vibecanvasCreateProxy(${JSON.stringify(name)});`
        : `export const ${name} = __vibecanvasCreateProxy(${JSON.stringify(name)});`
    )),
    '',
  ].join('\n');
}
