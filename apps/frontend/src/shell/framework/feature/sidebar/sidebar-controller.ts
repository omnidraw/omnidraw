import { showErrorToast, showSuccessToast } from '../../components/ui/Toast';
import type { TFrontendRuntime } from '@/shell/runtime/frontend-runtime';
import type { TSidebarApiPort, TSidebarController } from './ports';

export function createFrontendSidebarController(
  runtime: TFrontendRuntime,
  args: Readonly<{
    pathname(): string;
    navigate(path: string, options?: { replace?: boolean }): void;
  }>,
): TSidebarController {
  const api = {
    canvas: {
      create: (input) => runtime.api.safeRequest('canvas.create', input),
      list: (input = {}) => runtime.api.safeRequest('canvas.list', input),
      update: (input) => runtime.api.safeRequest('canvas.update', input),
      deletionPlan: (input) => runtime.api.safeRequest('canvas.deletionPlan', input),
      remove: (input) => runtime.api.safeRequest('canvas.remove', input),
    },
    resource: {
      resources: {
        list: (input = {}) => runtime.api.safeRequest('resource.resources.list', input),
        create: (input) => runtime.api.safeRequest('resource.resources.create', input),
      },
    },
    widget: {
      catalog: {
        get: () => runtime.api.safeRequest('widget.catalog.get'),
        events: async (input) => [null, runtime.api.widgetCatalogEvents(input)] as const,
        files: {
          list: (input) => runtime.api.safeRequest('widget.catalog.files.list', input),
          read: (input) => runtime.api.safeRequest('widget.catalog.files.read', input),
        },
      },
      config: {
        saveDraft: (input) => runtime.api.safeRequest('widget.config.saveDraft', input),
      },
      deletion: {
        plan: (input) => runtime.api.safeRequest('widget.deletion.plan', input),
        commit: (input) => runtime.api.safeRequest('widget.deletion.commit', input),
      },
      preview: {
        rebuildDraft: (input) => runtime.api.safeRequest('widget.preview.rebuildDraft', input),
      },
      publication: {
        publishMetadata: (input) => runtime.api.safeRequest('widget.publication.publishMetadata', input),
        updateIcon: (input) => runtime.api.safeRequest('widget.publication.updateIcon', input),
        buildAndPublish: (input) => runtime.api.safeRequest('widget.publication.buildAndPublish', input),
      },
    },
  } satisfies TSidebarApiPort['api'];
  return {
    apiService: { api },
    browser: {
      createIdempotencyKey: () => runtime.ownerWindow.crypto.randomUUID(),
      setTimeout: (callback, timeout) => runtime.ownerWindow.setTimeout(callback, timeout),
      clearTimeout: (timer) => runtime.ownerWindow.clearTimeout(timer as number),
    },
    invalidation: runtime.catalogInvalidation,
    lifecycle: Object.freeze({ fork: runtime.fork }),
    subscribeReconnect(listener) {
      let previous = runtime.rpc.generations.snapshot().generation;
      return runtime.rpc.generations.subscribe((state) => {
        if (state.connected && state.generation > previous) listener();
        previous = Math.max(previous, state.generation);
      });
    },
    widgetPlacement: runtime.widgetPlacement,
    application: {
      pathname: args.pathname,
      canvases: () => runtime.store.state.canvases,
      navigate: args.navigate,
      canvasCreated: (canvas) => runtime.store.set('canvases', (current) => [...current, canvas]),
      canvasUpdated: (canvas) => runtime.store.set('canvases', (current) => (
        current.map((item) => item.id === canvas.id ? canvas : item)
      )),
      canvasesReplaced: (canvases) => runtime.store.set('canvases', [...canvases]),
      themeAppearance: () => {
        void runtime.store.state.theme;
        return runtime.theme.service.getTheme().appearance;
      },
      setThemeAppearance: (appearance) => runtime.theme.setAppearance(appearance),
      toggleSidebar: () => runtime.store.set('sidebarVisible', (visible) => !visible),
      notifyError: showErrorToast,
      notifySuccess: showSuccessToast,
    },
  };
}
