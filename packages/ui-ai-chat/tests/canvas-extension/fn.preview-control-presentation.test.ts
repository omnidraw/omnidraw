import { describe, expect, test } from 'vitest';
import {
  fnPreviewControlPresentation,
} from '../../src/canvas-extension/fn.preview-control-presentation';

describe('fnPreviewControlPresentation', () => {
  test('uses disabled menu items for unavailable Cancel and Publish actions', () => {
    expect(fnPreviewControlPresentation({
      liveUpdatesPaused: false,
      pendingBuild: false,
      publishable: false,
    })).toEqual({
      'live-updates': { text: 'Pause live updates' },
      'cancel-build': { disabled: true },
      retry: {},
      reset: {},
      publish: { disabled: true },
    });
  });

  test('switches to Resume and enables current build actions', () => {
    expect(fnPreviewControlPresentation({
      liveUpdatesPaused: true,
      pendingBuild: true,
      publishable: true,
    })).toEqual({
      'live-updates': { text: 'Resume live updates' },
      'cancel-build': { disabled: false },
      retry: {},
      reset: {},
      publish: { disabled: false },
    });
  });
});
