import { describe, expect, test, vi } from 'vitest';
import { txRouteNotificationToast } from './tx.route-notification-toast';

describe('notification toast routing', () => {
  test('routes warning events only to the warning toast', () => {
    const portal = {
      showError: vi.fn(),
      showInfo: vi.fn(),
      showSuccess: vi.fn(),
      showWarning: vi.fn(),
    };

    txRouteNotificationToast(portal, {
      event: { type: 'warning', title: 'Node.js unavailable', description: 'Install Node.js and npm.' },
    });

    expect(portal.showWarning).toHaveBeenCalledWith('Node.js unavailable', 'Install Node.js and npm.');
    expect(portal.showError).not.toHaveBeenCalled();
    expect(portal.showInfo).not.toHaveBeenCalled();
    expect(portal.showSuccess).not.toHaveBeenCalled();
  });
});
