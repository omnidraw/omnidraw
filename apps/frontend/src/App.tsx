import { useLocation, useNavigate, type RouteSectionProps } from "@solidjs/router";
import { onCleanup, onMount } from "solid-js";
import { Toaster } from "./components/ui/Toast";
import { Sidebar, WidgetCatalogProvider } from "@omnidraw/ui-ai-chat";
import { setStore, store } from "./store";
import styles from "./App.module.css";
import { createFrontendSidebarController } from "./ai-chat-adapters";
import { bootstrapFrontendCanvases, registerFrontendCanvasBootstrapHost } from "./services/canvas-bootstrap";

const App = (props: RouteSectionProps) => {
  const location = useLocation();
  const navigate = useNavigate();
  const sidebarVisible = () => location.pathname === "/" || store.sidebarVisible;
  const sidebarController = createFrontendSidebarController({
    pathname: () => location.pathname,
    navigate,
  });

  const unregisterCanvasBootstrapHost = registerFrontendCanvasBootstrapHost({
    pathname: () => location.pathname,
    navigate,
  });
  onCleanup(unregisterCanvasBootstrapHost);

  onMount(() => {
    void bootstrapFrontendCanvases().catch(() => undefined);
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
