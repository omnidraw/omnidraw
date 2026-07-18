import { AutomergeUrl, DocHandle } from "@automerge/automerge-repo";
import type { IRuntime } from "@vibecanvas/runtime";
import type { TCanvasDoc } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import type { TCanvas } from "@vibecanvas/service-db/model";
import type { ThemeService } from "@vibecanvas/service-theme";
import { createEffect, createResource, createSignal, Match, onCleanup, Switch } from "solid-js";
import { findDocument } from "../automerge";
import { buildRuntime } from "../runtime";
import type { ICanvasRuntimeExtension } from "../extension";
import type { TCanvasImagePort, TCanvasToolbarGroupsPort } from "../types";

export type TBackendCanvas = TCanvas;

type CanvasPageProps = {
  canvas: TBackendCanvas;
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
  let runtime: IRuntime | null = null;
  const [bootError, setBootError] = createSignal<string | null>(null);
  const [docHandle] = createResource(() => props.canvas.automerge_url as AutomergeUrl, async (url) => {
    try {
      return await findDocument(url);
    } catch (e) {
      console.error("[CanvasPage] Failed to load automerge doc:", e);
      props.notification.showError("Failed to load automerge doc");
      throw e
    }
  });

  createEffect(() => {
    const nextHandle = docHandle();
    if (!nextHandle || nextHandle === activeHandle) return;

    activeHandle = nextHandle;
    if (runtime) {
      runtime.shutdown()
      runtime = null;
    }
    runtime = buildRuntime({
      canvasId: props.canvas.id,
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
    }, props.extensions)
    const bootingRuntime = runtime;
    setBootError(null);
    void bootingRuntime.boot().catch(async (error) => {
      if (runtime !== bootingRuntime) return;
      const message = error instanceof Error ? error.message : String(error);
      console.error('[CanvasPage] Failed to boot canvas runtime:', error);
      props.notification.showError('Failed to start canvas', message);
      setBootError(message);
      await bootingRuntime.shutdown().catch(() => undefined);
      if (runtime === bootingRuntime) runtime = null;
    });
  });

  onCleanup(() => {
    runtime?.shutdown();
    runtime = null;
    activeHandle = null;
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
