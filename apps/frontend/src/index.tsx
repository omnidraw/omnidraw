/* @refresh reload */
import "./index.css";
import { render } from "@solidjs/web";

import { createRouter, useParams } from "@solidjs/router";
import { lazy, Loading, Show } from "solid-js";
import App from "./shell/framework/App";
import WelcomePage from "./shell/framework/pages/welcome";
import routeStateStyles from "./shell/framework/styles/route-state.module.css";
import { FrontendRuntimeProvider } from "./shell/framework/runtime-context";
import { createLiveFrontendRuntime } from "./shell/runtime/frontend-runtime";

const CanvasPage = lazy(() => import("./shell/framework/pages/canvas"));
const ResourcePage = lazy(() => import("./shell/framework/pages/resource"));
const WidgetPage = lazy(() => import("./shell/framework/pages/widget"));

const CanvasRoute = () => {
  const params = useParams<{ id: string }>();
  const canvasId = () => params.id.trim();

  return (
    <Show
      when={canvasId().length > 0 && canvasId().length <= 200}
      fallback={
        <div class={routeStateStyles.root}>
          <p class={routeStateStyles.loadingText}>Invalid canvas link.</p>
        </div>
      }
    >
      <CanvasPage canvasId={canvasId()} />
    </Show>
  );
};

const Router = createRouter({
  routes: [
    { path: "/", component: WelcomePage },
    { path: "/c/:id", component: CanvasRoute },
    { path: "/resources/:id", component: ResourcePage },
    { path: "/widgets/:source/:name", component: WidgetPage },
  ],
});

const root = document.getElementById("root");

if (import.meta.env.DEV && !(root instanceof HTMLElement)) {
  throw new Error(
    "Root element not found. Did you forget to add it to your index.html? Or maybe the id attribute got misspelled?",
  );
}


const runtime = createLiveFrontendRuntime({ ownerWindow: window, ownerDocument: document });
const disposeView = render(
  () => (
    <FrontendRuntimeProvider runtime={runtime}>
      <Loading fallback={null}>
        <Router>
          {(props) => <App {...props} />}
        </Router>
      </Loading>
    </FrontendRuntimeProvider>
  ),
  root!,
);

const disposeApplication = (): void => {
  disposeView();
  void runtime.dispose();
};
window.addEventListener("pagehide", disposeApplication, { once: true });
import.meta.hot?.dispose(disposeApplication);
