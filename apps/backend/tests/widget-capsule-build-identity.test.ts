import { describe, expect, test } from 'bun:test';
import { CAPSULE_BUILD_API_VERSION } from '@omnidraw/capsule/protocol';
import rootPackage from '../../../package.json';
import { WIDGET_CAPSULE_BUILD_IDENTITY } from '../src/shell/widget/CONSTANTS';

describe('widget Capsule build identity', () => {
  test('matches the exact Capsule package and runtime used by the browser host', () => {
    expect(WIDGET_CAPSULE_BUILD_IDENTITY).toEqual({
      packageName: '@omnidraw/capsule',
      packageVersion: rootPackage.catalog['@omnidraw/capsule'],
      packageDigest: 'sha256:8ec771e3253c1c9e574285c34dac33003a982c9aa3b4d39f8c41f67b84ad3bed',
      buildApiVersion: CAPSULE_BUILD_API_VERSION,
      runtimeBuildDigest: 'sha256:e7c239a3853ff6918c22dc5cea4246e863a89938f75fccbab0dd8e76023c775d',
    });
  });
});
