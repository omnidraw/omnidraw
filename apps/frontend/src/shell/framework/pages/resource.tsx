import { useParams } from "@solidjs/router";
import { Show, createEffect, createSignal, type Component } from "solid-js";
import { DbResourcePage } from "@/shell/framework/feature/db-resource/DbResourcePage";
import { GenericResourcePage } from "@/shell/framework/feature/resource/GenericResourcePage";
import routeStateStyles from "@/shell/framework/styles/route-state.module.css";
import { fnBeginResourceRouteLoad, fnResolveResourceRouteLoad, type TResourceRouteLoadState } from "@/core/navigation/fn.resource-route";
import { useFrontendRuntime } from "../runtime-context";

export type TRouteResource = {
  id: string;
  kind: "kv" | "secretStore" | "db";
  name: string;
  status: string;
  lastError?: unknown;
  createdAtSec: string;
  updatedAtSec: string;
};

const ResourcePage: Component = () => {
  const params = useParams<{ id: string }>();
  const runtime = useFrontendRuntime();
  const [loadState, setLoadState] = createSignal<TResourceRouteLoadState<TRouteResource>>({
    requestId: 0,
    resourceId: "",
    resource: null,
    error: "",
  });
  const resource = () => loadState().resource;
  const error = () => loadState().error;
  let latestRequestId = 0;

  createEffect(
    () => params.id,
    (resourceId) => {
      const requestId = ++latestRequestId;
      setLoadState((state) => fnBeginResourceRouteLoad({ state, requestId, resourceId }));
      void runtime.api.safeRequest("resource.resources.get", { resourceId }).then(([loadError, value]) => {
        setLoadState((state) => fnResolveResourceRouteLoad({
          state,
          requestId,
          resourceId,
          resource: loadError || !value ? null : value,
          error: loadError?.message ?? (!value ? "Resource response was empty." : ""),
        }));
      });
    },
  );

  return (
    <Show keyed when={resource()} fallback={<div class={routeStateStyles.root} role="status" aria-live="polite"><div class={routeStateStyles.panel}><p class={routeStateStyles.loadingText}>{error() || "Loading resource…"}</p></div></div>}>
      {(current) => current.kind === "db"
        ? <DbResourcePage resourceId={current.id} />
        : <GenericResourcePage resource={current} />}
    </Show>
  );
};

export default ResourcePage;
