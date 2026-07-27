import { describe, expect, test, vi } from 'vitest';
import { txRouteWidgetCapsuleOutput } from './tx.route-widget-capsule-output';

describe('widget Capsule output routing', () => {
  test.each(['info', 'success', 'error'] as const)(
    'maps %s to only its fixed-title toast',
    (tone) => {
      const portal = {
        showError: vi.fn(),
        showInfo: vi.fn(),
        showSuccess: vi.fn(),
      };

      txRouteWidgetCapsuleOutput(portal, {
        output: {
          type: 'notification',
          tone,
          message: 'Operation complete',
        },
      });

      expect(portal[tone === 'info' ? 'showInfo' : tone === 'success'
        ? 'showSuccess'
        : 'showError']).toHaveBeenCalledWith('Widget', 'Operation complete');
      expect(
        portal.showError.mock.calls.length
        + portal.showInfo.mock.calls.length
        + portal.showSuccess.mock.calls.length,
      ).toBe(1);
    },
  );
});
