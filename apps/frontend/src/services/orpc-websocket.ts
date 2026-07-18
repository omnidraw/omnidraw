import { OrpcWebsocketService } from "@vibecanvas/orpc-client";
import { showErrorToast, showSuccessToast, showToast, showWarningToast } from "../components/ui/Toast";
import { txRouteNotificationToast } from "./tx.route-notification-toast";

export const orpcWebsocketService = new OrpcWebsocketService()

orpcWebsocketService.apiService.api.notification.events({}).then(async ([err, it]) => {
  if (err) {
    showErrorToast(err.name, err.message);
    return
  }
  for await (const event of it) {
    txRouteNotificationToast({
      showError: showErrorToast,
      showInfo: showToast,
      showSuccess: showSuccessToast,
      showWarning: showWarningToast,
    }, { event });
  }
});
