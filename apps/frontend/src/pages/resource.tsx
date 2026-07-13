import { useParams } from "@solidjs/router";
import { Show, createEffect, createSignal, type Component } from "solid-js";
import { DbResourcePage } from "@/feature/db-resource/DbResourcePage";
import { GenericResourcePage } from "@/feature/resource/GenericResourcePage";
import { orpcWebsocketService } from "@/services/orpc-websocket";
import routeStateStyles from "@/styles/route-state.module.css";
import { fnBeginResourceRouteLoad, fnResolveResourceRouteLoad, type TResourceRouteLoadState } from "./fn.resource-route";

export type TRouteResource = {
  id: string;
  kind: "kv" | "secretStore" | "db";
  name: string;
  status: string;
  last_error?: unknown;
  created_at: string;
  updated_at: string;
};

const ResourcePage: Component = () => {
  const params = useParams<{ id: string }>();
  const [loadState, setLoadState] = createSignal<TResourceRouteLoadState<TRouteResource>>({
    requestId: 0,
    resourceId: "",
    resource: null,
    error: "",
  });
  const resource = () => loadState().resource;
  const error = () => loadState().error;
  let latestRequestId = 0;

  createEffect(() => {
    const resourceId = params.id;
    const requestId = ++latestRequestId;
    setLoadState((state) => fnBeginResourceRouteLoad({ state, requestId, resourceId }));
    void orpcWebsocketService.apiService.api.actors.resources.get({ resourceId }).then(([loadError, value]) => {
      setLoadState((state) => fnResolveResourceRouteLoad({
        state,
        requestId,
        resourceId,
        resource: loadError || !value ? null : value,
        error: loadError?.message ?? (!value ? "Resource response was empty." : ""),
      }));
    });
  });

  return (
    <Show when={resource()} fallback={<div class={routeStateStyles.root} role="status" aria-live="polite"><div class={routeStateStyles.panel}><p class={routeStateStyles.loadingText}>{error() || "Loading resource…"}</p></div></div>}>
      {(current) => current().kind === "db"
        ? <DbResourcePage resourceId={current().id} />
        : <GenericResourcePage resource={current()} />}
    </Show>
  );
};

export default ResourcePage;
