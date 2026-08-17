/** @file Verifies the pure decision helpers behind the opt-in `link:local` command (D9). */

import { describe, expect, test } from 'bun:test';
import {
  npmrcContents,
  parseLinkTargets,
  resolveSiblingDirectory,
  selectLocalPublishScript,
} from './link-local-packages.mjs';

describe('link:local target parsing', () => {
  test('dedupes and trims requested targets', () => {
    expect(parseLinkTargets([' capsule ', 'capsule', 'cangine'])).toEqual(['capsule', 'cangine']);
  });

  test('drops empty entries (e.g. from an unset env var split on comma)', () => {
    expect(parseLinkTargets([''])).toEqual([]);
  });

  test('rejects an unknown target', () => {
    expect(() => parseLinkTargets(['capsule', 'not-a-real-package']))
      .toThrow('Unknown local-link target "not-a-real-package"');
  });
});

describe('link:local sibling directory resolution', () => {
  test('defaults to a checkout sibling next to the repository root', () => {
    expect(resolveSiblingDirectory('capsule', {}, '/workspace/omnidraw-oss'))
      .toBe('/workspace/capsule');
    expect(resolveSiblingDirectory('cangine', {}, '/workspace/omnidraw-oss'))
      .toBe('/workspace/cangine');
  });

  test('honors an explicit path override env var', () => {
    expect(resolveSiblingDirectory('capsule', {
      OMNIDRAW_CAPSULE_LOCAL_PATH: '/elsewhere/my-capsule-checkout',
    }, '/workspace/omnidraw-oss')).toBe('/elsewhere/my-capsule-checkout');
  });

  test('ignores a blank override and falls back to the sibling default', () => {
    expect(resolveSiblingDirectory('cangine', {
      OMNIDRAW_CANGINE_LOCAL_PATH: '   ',
    }, '/workspace/omnidraw-oss')).toBe('/workspace/cangine');
  });
});

describe('link:local publish-script selection', () => {
  test('picks the first known script name a producer repo exposes', () => {
    expect(selectLocalPublishScript({ 'package:publish:local': 'x' })).toBe('package:publish:local');
    expect(selectLocalPublishScript({ 'package:publish-local': 'x' })).toBe('package:publish-local');
    expect(selectLocalPublishScript({ 'publish:local': 'x' })).toBe('publish:local');
  });

  test('prefers the earlier-listed convention when a repo exposes more than one', () => {
    expect(selectLocalPublishScript({
      'publish:local': 'x',
      'package:publish:local': 'y',
    })).toBe('package:publish:local');
  });

  test('returns null when no known local-publish script exists', () => {
    expect(selectLocalPublishScript({ build: 'x' })).toBeNull();
    expect(selectLocalPublishScript()).toBeNull();
  });
});

describe('link:local generated .npmrc', () => {
  test('scopes @omnidraw to the unauthenticated loopback registry', () => {
    const contents = npmrcContents('http://127.0.0.1:4873/');
    expect(contents).toContain('@omnidraw:registry=http://127.0.0.1:4873/');
    expect(contents).toContain('Run `bun run link:local:reset` to remove this file.');
    expect(contents).not.toContain('_authToken');
    expect(contents).not.toContain('always-auth');
  });
});
