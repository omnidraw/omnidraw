import { showErrorToast, showSuccessToast, showToast } from "@/components/ui/Toast";
import { orpcWebsocketService } from "@/services/orpc-websocket";
import { themeService } from "@/services/theme";
import { setStore, store } from "@/store";
import type { TBackendCanvas } from "@/types/backend.types";
import { Canvas } from "@vibecanvas/canvas";
import { type Component } from "solid-js";

type CanvasPageProps = {
  canvas: TBackendCanvas;
};

const CanvasPage: Component<CanvasPageProps> = (props) => {

  return (
    <Canvas
      canvas={props.canvas}
      apiService={orpcWebsocketService.apiService}
      notification={{ showError: showErrorToast, showSuccess: showSuccessToast, showInfo: showToast }}
      themeService={themeService}
      store={{ sidebarVisible: () => store.sidebarVisible, onToggleSidebar: () => setStore('sidebarVisible', v => !v) }}
    />
  );
};

export default CanvasPage;
