import { describe, expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';
import { fnWidgetNpmScratchRoot } from './fn.widget-npm-scratch-root';

function isInside(root: string, path: string): boolean {
  const prefix = root.endsWith('/') ? root : `${root}/`;
  return path === root || path.startsWith(prefix);
}

describe('fnWidgetNpmScratchRoot', () => {
  test('places npm scratch under tmpdir, never under the Omnidraw home tree', () => {
    const tmpdir = '/var/folders/xx/tmp';
    const homeDir = '/Users/dev/omnidraw/.omnidraw';
    const scratch = fnWidgetNpmScratchRoot({ tmpdir, homeDir });
    expect(isInside(tmpdir, scratch)).toBe(true);
    expect(isInside(homeDir, scratch)).toBe(false);
    expect(scratch.startsWith(`${tmpdir}/omnidraw-widget-npm-`)).toBe(true);
    expect(scratch.slice(`${tmpdir}/omnidraw-widget-npm-`.length)).toHaveLength(12);
  });

  test('hashes the home dir so two worktrees do not share one scratch tree', () => {
    const tmpdir = '/tmp';
    const left = fnWidgetNpmScratchRoot({ tmpdir, homeDir: '/a/.omnidraw' });
    const right = fnWidgetNpmScratchRoot({ tmpdir, homeDir: '/b/.omnidraw' });
    expect(left).not.toBe(right);
  });

  test('live mechanics does not join widget npm scratch onto home.tempRoot', async () => {
    const text = await Bun.file(fileURLToPath(
      new URL('../runtime/layer.live-mechanics.ts', import.meta.url),
    )).text();
    expect(text).toContain('fnWidgetNpmScratchRoot');
    expect(text).not.toContain("join(config.home.tempRoot, 'widget-builds')");
    expect(text).not.toContain("join(config.home.tempRoot, 'widget-source-checks')");
    expect(text).not.toContain("join(config.home.tempRoot, 'widget-function-descriptors')");
  });
});
