import { showErrorToast, showSuccessToast, showToast } from "@/components/ui/Toast";
import { themeService } from "@/services/theme";
import { setStore, store } from "@/store";
import type { TBackendCanvas } from "@/types/backend.types";
import {
  Canvas,
  fnReproductionTraceDiagnostics,
} from "@vibecanvas/canvas";
import { useNavigate } from "@solidjs/router";
import { type Component } from "solid-js";
import { canvasImagePort, createFrontendAiChatExtension } from "../ai-chat-adapters";
import { createBrowserTenantBoundary } from "../services/tenant";
import { canvasDocumentTransport } from "../services/canvas-document-transport";

type CanvasPageProps = {
  canvas: TBackendCanvas;
};

const CanvasPage: Component<CanvasPageProps> = (props) => {
  const navigate = useNavigate();
  const aiChatExtension = createFrontendAiChatExtension({ navigate });
  const tenantCanvas = createBrowserTenantBoundary((tenant) => (
    <Canvas
      canvas={props.canvas}
      diagnostics={fnReproductionTraceDiagnostics({
        development: import.meta.env.DEV,
        applicationVersion: import.meta.env.VITE_APP_VERSION,
        buildMode: import.meta.env.MODE,
        cangineVersion: "0.4.0",
      })}
      tenant={tenant}
      transport={canvasDocumentTransport}
      extensions={[aiChatExtension]}
      image={canvasImagePort}
      notification={{ showError: showErrorToast, showSuccess: showSuccessToast, showInfo: showToast }}
      themeService={themeService}
      store={{ sidebarVisible: () => store.sidebarVisible, onToggleSidebar: () => setStore('sidebarVisible', v => !v) }}
    />
  ));

  return <>{tenantCanvas()}</>;
};

export default CanvasPage;
