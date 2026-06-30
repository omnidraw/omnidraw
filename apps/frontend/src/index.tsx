/* @refresh reload */
import "./index.css";
import { render } from "solid-js/web";
import "solid-devtools";
import "./services/orpc-websocket";
import "./services/theme";

import { Route, Router, useParams } from "@solidjs/router";
import { Show } from "solid-js";
import App from "./App";
import CanvasPage from "./pages/canvas";
import WelcomePage from "./pages/welcome";
import { store } from "./store";
import routeStateStyles from "./styles/route-state.module.css";

const CanvasRoute = () => {
  const params = useParams<{ id: string }>();
  const canvas = () => store.canvases.find((c) => c.id === params.id);

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

render(
  () => (
    <Router root={App}>
      <Route path="/" component={WelcomePage} />
      <Route path="/c/:id" component={CanvasRoute} />
    </Router>
  ),
  root!,
);
