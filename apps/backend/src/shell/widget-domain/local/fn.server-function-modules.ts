/** @file Pure transient server-function module discovery and synthetic entry generation. */

export type TServerFunctionModule = Readonly<{
  path: string;
  exportNames: readonly string[];
}>;

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
