import { useLocation, type RouteSectionProps } from "@solidjs/router";
import { onMount } from "solid-js";
import { Toaster } from "./components/ui/Toast";
import { Sidebar } from "./feature/sidebar";
import { setStore, store } from "./store";
import styles from "./App.module.css";

const App = (props: RouteSectionProps) => {
  const location = useLocation();
  const sidebarVisible = () => location.pathname === "/" || store.sidebarVisible;

  onMount(() => {
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
