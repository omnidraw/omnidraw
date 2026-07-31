/** @file Pure server-function export mapping and synthetic entry generation. */

import type { TWidgetServerFunctionDescriptor } from '../types';

export type TServerFunctionModule = Readonly<{
  path: string;
  exportNames: readonly string[];
}>;

export function fnAttachServerFunctionModulePaths(
  descriptors: readonly TWidgetServerFunctionDescriptor[],
  modules: readonly TServerFunctionModule[],
): readonly TWidgetServerFunctionDescriptor[] {
  const moduleByExport = new Map<string, string>();
  for (const module of modules) {
    for (const exportName of module.exportNames) moduleByExport.set(exportName, module.path);
  }
  return Object.freeze(descriptors.map((descriptor) => {
    const modulePath = moduleByExport.get(descriptor.exportName);
    if (modulePath === undefined) {
      throw new Error('Registration sandbox returned an export absent from the pinned server graph.');
    }
    return Object.freeze({ ...descriptor, modulePath });
  }));
}

export function fnGenerateServerFunctionEntrySource(
  serverEntry: string,
  modules: readonly TServerFunctionModule[],
): string {
  const lines = [`import ${JSON.stringify(`./${serverEntry}`)};`];
  const exports: string[] = [];
  let index = 0;
  for (const module of modules) {
    for (const exportName of module.exportNames) {
      const localName = `__omnidrawFunction${index++}`;
      lines.push(
        `import { ${exportName} as ${localName} } from ${JSON.stringify(`./${module.path}`)};`,
      );
      exports.push(`${localName} as ${exportName}`);
    }
  }
  lines.push(exports.length === 0 ? 'export {};' : `export { ${exports.join(', ')} };`, '');
  return lines.join('\n');
}
