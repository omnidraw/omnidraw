import { OrpcWebsocketService } from "@vibecanvas/orpc-client";
import { showErrorToast, showSuccessToast, showToast } from "../components/ui/Toast";

export const orpcWebsocketService = new OrpcWebsocketService()

orpcWebsocketService.apiService.api.notification.events({}).then(async ([err, it]) => {
  if (err) {
    showErrorToast(err.name, err.message);
    return
  }
  for await (const event of it) {
    if (event.type === "error") showErrorToast(event.title, event.description);
    else if (event.type === "success") showSuccessToast(event.title, event.description);
    else showToast(event.title, event.description);
  }
});