import { useParams } from "@solidjs/router";
import { Show, createEffect, createSignal, type Component } from "solid-js";
import { DbResourcePage } from "@/feature/db-resource/DbResourcePage";
import { GenericResourcePage } from "@/feature/resource/GenericResourcePage";
import { orpcWebsocketService } from "@/services/orpc-websocket";
import routeStateStyles from "@/styles/route-state.module.css";

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
  const [resource, setResource] = createSignal<TRouteResource | null>(null);
  const [error, setError] = createSignal("");

  createEffect(() => {
    const resourceId = params.id;
    setResource(null);
    setError("");
    void orpcWebsocketService.apiService.api.actors.resources.get({ resourceId }).then(([loadError, value]) => {
      if (loadError || !value) {
        setError(loadError?.message ?? "Resource response was empty.");
        return;
      }
      setResource(value);
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
