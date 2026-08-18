import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { describe, expect, test } from 'bun:test';

const packageRoot = join(import.meta.dir, '..');
const retired = [
  '@omnidraw/widget-contract',
  '@omnidraw/capsule-omnidraw',
  '@omnidraw/resource-runtime',
  '@omnidraw/function-runtime',
  '@omnidraw/runtime',
];

async function files(root: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) result.push(...await files(path));
    else result.push(path);
  }
  return result;
}

describe('@omnidraw/sdk package boundaries', () => {
  test('uses exact implementation dependencies and no retired packages', async () => {
    const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
    expect(manifest.version).toBe('0.13.0');
    expect(manifest.dependencies).toEqual({
      '@babel/parser': '7.29.8',
      '@babel/traverse': '7.29.8',
      '@omnidraw/capsule': '0.16.0',
      effect: '4.0.0-rc.108',
      'lucide-static': '1.24.0',
    });
    for (const path of await files(join(packageRoot, 'src'))) {
      const source = await readFile(path, 'utf8');
      for (const specifier of retired) expect(source).not.toContain(specifier);
    }
  });

  test('publishes no implementation-owned types through reachable declarations', async () => {
    const publicDeclarations = (await files(join(packageRoot, 'dist')))
      .filter((path) => path.endsWith('.d.ts') && !relative(join(packageRoot, 'dist'), path).startsWith('internal/capsule/'));
    for (const path of publicDeclarations) {
      const declaration = await readFile(path, 'utf8');
      expect(declaration).not.toMatch(/from ['"](?:@omnidraw\/capsule|effect|zod|@omnidraw\/widget-contract|@omnidraw\/capsule-omnidraw)/);
    }

    const hostDeclaration = await readFile(join(packageRoot, 'dist', 'host.d.ts'), 'utf8');
    expect(hostDeclaration).not.toMatch(/TWidgetCapsule|capsuleArtifactHash/);
    const contractRuntime = await readFile(join(packageRoot, 'dist', 'contract.js'), 'utf8');
    expect(contractRuntime).not.toMatch(/capsule:bridge|from ['"](?:@omnidraw\/capsule|effect|zod)['"]/);
    const typesDeclaration = await readFile(join(packageRoot, 'dist', 'contracts', 'types.d.ts'), 'utf8');
    for (const retiredPublicName of [
      'TWidgetCapsuleHostConfiguration',
      'TWidgetCapsuleRuntimeDescriptor',
      'TWidgetCapsuleTheme',
      'TWidgetCapsuleProps',
      'TWidgetCapsuleNotificationOutput',
      'capsuleArtifactHash',
    ]) expect(typesDeclaration).not.toContain(retiredPublicName);
  });
});
