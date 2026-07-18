import { showErrorToast, showSuccessToast, showToast } from "@/components/ui/Toast";
import { orpcWebsocketService } from "@/services/orpc-websocket";
import { themeService } from "@/services/theme";
import { setStore, store } from "@/store";
import type { TBackendCanvas } from "@/types/backend.types";
import { Canvas } from "@vibecanvas/canvas";
import { useNavigate } from "@solidjs/router";
import { type Component } from "solid-js";
import { RESOURCE_CATALOG_CHANGED_EVENT } from "../feature/sidebar/components/CONSTANTS";

type CanvasPageProps = {
  canvas: TBackendCanvas;
};

const CanvasPage: Component<CanvasPageProps> = (props) => {
  const navigate = useNavigate();

  return (
    <Canvas
      canvas={props.canvas}
      apiService={orpcWebsocketService.apiService}
      notification={{ showError: showErrorToast, showSuccess: showSuccessToast, showInfo: showToast }}
      themeService={themeService}
      onOpenResource={(resourceId) => navigate(`/resources/${encodeURIComponent(resourceId)}`)}
      onResourceCatalogChanged={() => window.dispatchEvent(new Event(RESOURCE_CATALOG_CHANGED_EVENT))}
      store={{ sidebarVisible: () => store.sidebarVisible, onToggleSidebar: () => setStore('sidebarVisible', v => !v) }}
    />
  );
};

export default CanvasPage;
