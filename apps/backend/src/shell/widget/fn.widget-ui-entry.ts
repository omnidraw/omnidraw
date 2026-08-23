export function fnBootstrapWidgetUiEntry(
  source: string,
  bootstrapSpecifier: string,
): string {
  const bootstrapImport = `import ${JSON.stringify(bootstrapSpecifier)};`;
  if (source.startsWith(`${bootstrapImport}\n`)) return source;

  const bom = source.startsWith('\uFEFF') ? '\uFEFF' : '';
  const body = bom === '' ? source : source.slice(1);
  if (!body.startsWith('#!')) {
    return `${bom}${bootstrapImport}\n${body}`;
  }

  const lineEnd = body.indexOf('\n');
  if (lineEnd === -1) {
    return `${bom}${body}\n${bootstrapImport}\n`;
  }
  return `${bom}${body.slice(0, lineEnd + 1)}${bootstrapImport}\n${body.slice(lineEnd + 1)}`;
}
