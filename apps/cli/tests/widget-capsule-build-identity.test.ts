import { describe, expect, test } from 'bun:test';
import rootPackage from '../../../package.json';
import { WIDGET_CAPSULE_BUILD_IDENTITY } from '../src/services/CONSTANTS';

describe('widget Capsule build identity', () => {
  test('matches the Capsule version used by the browser host', () => {
    expect(WIDGET_CAPSULE_BUILD_IDENTITY.packageVersion).toBe(
      rootPackage.catalog['@omnidraw/capsule'],
    );
  });
});
