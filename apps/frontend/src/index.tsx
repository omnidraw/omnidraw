/* @refresh reload */
import "./index.css";
import { render } from "solid-js/web";
if (import.meta.env.DEV) void import("solid-devtools");

import { Route, Router, useParams } from "@solidjs/router";
import { lazy, Show } from "solid-js";
import App from "./shell/framework/App";
import WelcomePage from "./shell/framework/pages/welcome";
import routeStateStyles from "./shell/framework/styles/route-state.module.css";
import { FrontendRuntimeProvider, useFrontendRuntime } from "./shell/framework/runtime-context";
import { createLiveFrontendRuntime } from "./shell/runtime/frontend-runtime";

const CanvasPage = lazy(() => import("./shell/framework/pages/canvas"));
const ResourcePage = lazy(() => import("./shell/framework/pages/resource"));
const WidgetPage = lazy(() => import("./shell/framework/pages/widget"));

const CanvasRoute = () => {
  const runtime = useFrontendRuntime();
  const params = useParams<{ id: string }>();
  const canvas = () => runtime.store.state.canvases.find((c) => c.id === params.id);

  return (
    <Show
      when={canvas()}
      fallback={
        <div class={routeStateStyles.root}>
          <p class={routeStateStyles.loadingText}>Loading canvas...</p>
        </div>
      }
    >
      {(c) => <CanvasPage canvas={c()} />}
    </Show>
  );
};

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
      <Router root={App}>
        <Route path="/" component={WelcomePage} />
        <Route path="/c/:id" component={CanvasRoute} />
        <Route path="/resources/:id" component={ResourcePage} />
        <Route path="/widgets/:source/:name" component={WidgetPage} />
      </Router>
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
