import type { TNotificationEvent } from '@omnidraw/api/notification/contract';

type TPortal = {
  showError: (title: string, description?: string) => unknown;
  showInfo: (title: string, description?: string) => unknown;
  showSuccess: (title: string, description?: string) => unknown;
  showWarning: (title: string, description?: string) => unknown;
};

type TArgs = {
  event: TNotificationEvent;
};

export function txRouteNotificationToast(portal: TPortal, args: TArgs): void {
  if (args.event.type === 'error') {
    portal.showError(args.event.title, args.event.description);
    return;
  }
  if (args.event.type === 'success') {
    portal.showSuccess(args.event.title, args.event.description);
    return;
  }
  if (args.event.type === 'warning') {
    portal.showWarning(args.event.title, args.event.description);
    return;
  }
  portal.showInfo(args.event.title, args.event.description);
}
