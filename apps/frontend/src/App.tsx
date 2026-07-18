import { useLocation, useNavigate, type RouteSectionProps } from "@solidjs/router";
import { onMount } from "solid-js";
import { showErrorToast, Toaster } from "./components/ui/Toast";
import { Sidebar, WidgetCatalogProvider } from "@vibecanvas/ai-chat";
import { orpcWebsocketService } from "./services/orpc-websocket";
import { createStartupCanvasBootstrap } from "./startup-canvas";
import { setStore, store } from "./store";
import styles from "./App.module.css";
import { createFrontendSidebarController } from "./ai-chat-adapters";

const App = (props: RouteSectionProps) => {
  const location = useLocation();
  const navigate = useNavigate();
  const sidebarVisible = () => location.pathname === "/" || store.sidebarVisible;
  const sidebarController = createFrontendSidebarController({
    pathname: () => location.pathname,
    navigate,
  });

  const bootstrapCanvases = createStartupCanvasBootstrap({
    listCanvases: () => orpcWebsocketService.apiService.api.canvas.list(),
    createCanvas: (name) => orpcWebsocketService.apiService.api.canvas.create({ name }),
    setCanvases: (canvases) => setStore("canvases", canvases),
    navigate,
    onError: (message) => showErrorToast(message),
  });

  onMount(() => {
    void bootstrapCanvases({ pathname: location.pathname }).catch(() => undefined);
    document.addEventListener("wheel", (e) => {
      if (e.ctrlKey) {
        e.preventDefault();
      }
    }, { passive: false });
  });

  return (
    <WidgetCatalogProvider controller={sidebarController}>
      <div class={styles.shell}>
        <Sidebar
          controller={sidebarController}
          visible={sidebarVisible()}
          onToggleSidebar={() => setStore("sidebarVisible", (visible) => !visible)}
        />
        <main id="main" class={styles.main}>
          {props.children}
        </main>
        <Toaster />
      </div>
    </WidgetCatalogProvider>
  );
};

export default App;
