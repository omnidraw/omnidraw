import { showErrorToast, showSuccessToast, showToast } from "@/components/ui/Toast";
import { themeService } from "@/services/theme";
import { setStore, store } from "@/store";
import type { TBackendCanvas } from "@/types/backend.types";
import { Canvas } from "@vibecanvas/canvas";
import { useNavigate } from "@solidjs/router";
import { type Component } from "solid-js";
import { canvasImagePort, canvasToolbarGroupsPort, createFrontendAiChatExtension } from "../ai-chat-adapters";

type CanvasPageProps = {
  canvas: TBackendCanvas;
};

const CanvasPage: Component<CanvasPageProps> = (props) => {
  const navigate = useNavigate();
  const aiChatExtension = createFrontendAiChatExtension({ navigate });

  return (
    <Canvas
      canvas={props.canvas}
      extensions={[aiChatExtension]}
      image={canvasImagePort}
      toolbarGroups={canvasToolbarGroupsPort}
      notification={{ showError: showErrorToast, showSuccess: showSuccessToast, showInfo: showToast }}
      themeService={themeService}
      store={{ sidebarVisible: () => store.sidebarVisible, onToggleSidebar: () => setStore('sidebarVisible', v => !v) }}
    />
  );
};

export default CanvasPage;
