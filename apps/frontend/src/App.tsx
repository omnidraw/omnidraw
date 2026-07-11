import { useLocation, useNavigate, type RouteSectionProps } from "@solidjs/router";
import { onMount } from "solid-js";
import { showErrorToast, Toaster } from "./components/ui/Toast";
import { Sidebar } from "./feature/sidebar";
import { orpcWebsocketService } from "./services/orpc-websocket";
import { createStartupCanvasBootstrap } from "./startup-canvas";
import { setStore, store } from "./store";
import styles from "./App.module.css";

const App = (props: RouteSectionProps) => {
  const location = useLocation();
  const navigate = useNavigate();
  const sidebarVisible = () => location.pathname === "/" || store.sidebarVisible;

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
    <div class={styles.shell}>
      <Sidebar
        visible={sidebarVisible()}
        onToggleSidebar={() => setStore("sidebarVisible", (visible) => !visible)}
      />
      <main id="main" class={styles.main}>
        {props.children}
      </main>
      <Toaster />
    </div>
  );
};

export default App;
