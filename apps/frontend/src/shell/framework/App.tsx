import { useLocation, useNavigate, type RouteSectionProps } from "@solidjs/router";
import { onCleanup, onMount } from "solid-js";
import { Toaster } from "./components/ui/Toast";
import { Sidebar, WidgetCatalogProvider } from "./feature/sidebar";
import styles from "./App.module.css";
import { createFrontendSidebarController } from "./feature/sidebar/sidebar-controller";
import { createFrontendCanvasBootstrap } from "../canvas/canvas-bootstrap";
import { startFrontendNotifications } from "../browser/notifications";
import { useFrontendRuntime } from "./runtime-context";

const App = (props: RouteSectionProps) => {
  const location = useLocation();
  const navigate = useNavigate();
  const runtime = useFrontendRuntime();
  const sidebarVisible = () => location.pathname === "/" || runtime.store.state.sidebarVisible;
  const sidebarController = createFrontendSidebarController(runtime, {
    pathname: () => location.pathname,
    navigate,
  });
  const bootstrap = createFrontendCanvasBootstrap(runtime, {
    pathname: () => location.pathname,
    navigate,
  });
  onCleanup(bootstrap.dispose);

  onMount(() => {
    const stopNotifications = startFrontendNotifications(runtime);
    onCleanup(stopNotifications);
    void bootstrap.run();
    const preventBrowserZoom = (event: WheelEvent): void => {
      if (event.ctrlKey) event.preventDefault();
    };
    runtime.ownerDocument.addEventListener("wheel", preventBrowserZoom, { passive: false });
    onCleanup(() => runtime.ownerDocument.removeEventListener("wheel", preventBrowserZoom));
  });

  return (
    <WidgetCatalogProvider controller={sidebarController}>
      <div class={styles.shell}>
        <Sidebar
          controller={sidebarController}
          visible={sidebarVisible()}
          onToggleSidebar={() => runtime.store.set("sidebarVisible", (visible) => !visible)}
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
