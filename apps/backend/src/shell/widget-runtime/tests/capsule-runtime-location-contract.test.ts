import { describe, expect, test } from 'bun:test';
import {
  CAPSULE_MOUNT_ERROR_FORMAT,
  type CapsuleHandle,
  type CapsuleHost,
  type CapsuleMountErrorEvent,
  type CapsuleRuntimeLocation,
} from '@omnidraw/capsule';

describe('Capsule 0.16.0 runtime-location public contract', () => {
  test('exposes the exact v3 format and coordinate convention at the root', () => {
    const location: CapsuleRuntimeLocation = {
      module: 'main.js',
      line: 1,
      column: 0,
    };
    expect(CAPSULE_MOUNT_ERROR_FORMAT).toBe('capsule-mount-error-v3');
    expect(location).toEqual({ module: 'main.js', line: 1, column: 0 });
  });

  test('types startup and post-mount listeners with the same public event', () => {
    const startup: Parameters<CapsuleHost['mount']>[0]['onError'] = (
      event: CapsuleMountErrorEvent,
    ) => event.format;
    const postMount: Parameters<CapsuleHandle['onError']>[0] = (
      event: CapsuleMountErrorEvent,
    ) => event.format;
    expect(startup).toBeFunction();
    expect(postMount).toBeFunction();
  });
});
