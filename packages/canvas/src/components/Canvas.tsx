import { AutomergeUrl, DocHandle } from "@automerge/automerge-repo";
import type { TCanvasDoc } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import type { TCanvas } from "@vibecanvas/service-db/model";
import type { ThemeService } from "@vibecanvas/service-theme";
import { createEffect, createResource, createSignal, Match, onCleanup, onMount, Switch } from "solid-js";
import { findDocument } from "../automerge";
import { buildRuntime } from "../runtime";
import type { ICanvasRuntimeExtension } from "../extension";
import type { TCanvasImagePort, TCanvasToolbarGroupsPort } from "../types";
import type { TBrowserTenantScope } from "../fn.browser-tenant-scope";
import { fnBrowserTenantScopeKey } from "../fn.browser-tenant-scope";
import { CanvasRuntimeLifecycle } from "./CanvasRuntimeLifecycle";

export type TBackendCanvas = TCanvas;

type CanvasPageProps = {
  canvas: TBackendCanvas;
  tenant: TBrowserTenantScope;
  extensions?: readonly ICanvasRuntimeExtension[];
  image: TCanvasImagePort;
  toolbarGroups?: TCanvasToolbarGroupsPort;
  store: {
    sidebarVisible: () => boolean;
    onToggleSidebar: () => void;
  },
  notification: {
    showSuccess(title: string, description?: string): void
    showError(title: string, description?: string): void
    showInfo(title: string, description?: string): void
  }
  themeService: ThemeService;
};


export function Canvas(props: CanvasPageProps) {
  let containerRef!: HTMLDivElement;
  let activeHandle: DocHandle<TCanvasDoc> | null = null;
  const [bootError, setBootError] = createSignal<string | null>(null);
  const [containerReady, setContainerReady] = createSignal(false);
  const canvasSource = () => ({
    scope: props.tenant,
    scopeKey: fnBrowserTenantScopeKey(props.tenant),
    url: props.canvas.automerge_url as AutomergeUrl,
  });
  const [docHandle] = createResource(canvasSource, async ({ scope, url }) => {
    try {
      return await findDocument(scope, url);
    } catch (e) {
      console.error("[CanvasPage] Failed to load automerge doc:", e);
      props.notification.showError("Failed to load automerge doc");
      throw e
    }
  });

  const lifecycle = new CanvasRuntimeLifecycle<DocHandle<TCanvasDoc>>({
    createRuntime: (nextHandle) => {
      return buildRuntime({
        canvasId: props.canvas.id,
        tenant: props.tenant,
        container: containerRef,
        docHandle: nextHandle,
        onToggleSidebar: props.store.onToggleSidebar,
        env: {
          DEV: import.meta.env.DEV,
        },
        image: props.image,
        toolbarGroups: props.toolbarGroups,
        notification: props.notification,
        themeService: props.themeService,
      }, props.extensions);
    },
    onBootStart: () => {
      setBootError(null);
    },
    onBootError: (error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[CanvasPage] Failed to boot canvas runtime:", error);
      props.notification.showError("Failed to start canvas", message);
      setBootError(message);
    },
    onShutdownError: (error) => {
      console.error("[CanvasPage] Failed to stop canvas runtime:", error);
    },
  });

  createEffect<string | null>((previousSourceKey) => {
    const source = canvasSource();
    const sourceKey = `${source.scopeKey}:${source.url}`;
    if (previousSourceKey !== null && sourceKey !== previousSourceKey) {
      activeHandle = null;
      void lifecycle.replace(null);
    }
    return sourceKey;
  }, null);

  createEffect(() => {
    const nextHandle = docHandle();
    if (!containerReady() || !nextHandle || nextHandle === activeHandle) return;

    activeHandle = nextHandle;
    void lifecycle.replace(nextHandle);
  });

  onMount(() => {
    setContainerReady(true);
  });

  onCleanup(() => {
    setContainerReady(false);
    activeHandle = null;
    void lifecycle.dispose();
  });

  return <div ref={containerRef} style={{ position: "relative", width: "100%", height: "100%", background: "var(--vc-canvas-background, rgba(168, 162, 158, 0.10))" }}>
    <Switch>
      <Match when={docHandle.loading}>
        <div>Loading...</div>
      </Match>
      <Match when={docHandle.error}>
        <div>Error</div>
      </Match>
      <Match when={bootError()}>
        {(message) => <div role="alert" style={{ position: 'absolute', inset: '0', display: 'grid', 'place-items': 'center', padding: '24px', color: 'var(--vc-text-primary, #111827)' }}>
          Canvas failed to start: {message()}
        </div>}
      </Match>
    </Switch>
  </div>;
}
