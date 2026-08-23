import { Bot, PanelLeft } from '@/shell/framework/components/icons';
import type {
  TCanvasDependencies,
  TCanvasExtensionLoader,
  TCanvasToolbarContribution,
  TCanvasWaitPort,
  TReproductionTraceOwner,
} from '@omnidraw/canvas';
import { createReproductionTrace } from '@omnidraw/canvas';
import {
  fnReadCanvasWidgetExtension,
  type TCanvasDescriptor,
} from '@omnidraw/canvas-contract';
import {
  createAiChatCanvasExtensionLoaderDescriptor,
} from '@omnidraw/component-ai-chat/canvas-frame';
import { showErrorToast, showSuccessToast, showToast } from '../framework/components/ui/Toast';
import { createCanvasImagePort } from './canvas-image-port';
import {
  createFrontendCanvasDocumentTransport,
  createFrontendCanvasInitialBootRecovery,
} from './canvas-document-transport';
import type { TFrontendRuntime } from '../runtime/frontend-runtime';
import { startFrontendDatabaseEvents } from '../browser/database-events';
import { createWidgetPreviewAutomation } from '../framework/feature/canvas-extension/preview-automation';
import {
  createFrontendWidgetPlacementExtension,
} from '../framework/feature/widget-placement/canvas-extension';

type TCreateFrontendCanvasCompositionArgs = Readonly<{
  canvasId: string;
  navigate(path: string): void;
  ownerDocument: Document;
  runtime: TFrontendRuntime;
}>;

export type TFrontendCanvasComposition = Readonly<{
  canvas: TCanvasDescriptor;
  dependencies: TCanvasDependencies;
  dispose(): void;
}>;

function createBrowserWaitPort(ownerWindow: Window): TCanvasWaitPort {
  return Object.freeze({
    wait(delayMs) {
      let finish!: () => void;
      const promise = new Promise<void>((resolve) => {
        finish = resolve;
      });
      let settled = false;
      const settle = (): void => {
        if (settled) return;
        settled = true;
        ownerWindow.clearTimeout(timeout);
        finish();
      };
      const timeout = ownerWindow.setTimeout(settle, Math.max(0, delayMs));
      return Object.freeze({ promise, cancel: settle });
    },
  });
}

function createFrontendDiagnostics(
  ownerDocument: Document,
  canvasId: string,
): TReproductionTraceOwner | undefined {
  if (!import.meta.env.DEV) return undefined;
  const ownerWindow = ownerDocument.defaultView;
  if (ownerWindow === null) {
    throw new Error('Canvas diagnostics require a browser window.');
  }
  const browserNavigator = ownerWindow.navigator;
  return createReproductionTrace({
    environment: () => ({
      applicationVersion: import.meta.env.VITE_APP_VERSION ?? 'unknown',
      buildMode: import.meta.env.MODE,
      canvasId,
      cangineVersion: '0.7.0',
      browser: browserNavigator.userAgent.slice(0, 256),
      platform: browserNavigator.platform || 'unknown',
      viewport: {
        width: ownerWindow.innerWidth,
        height: ownerWindow.innerHeight,
      },
      devicePixelRatio: ownerWindow.devicePixelRatio,
    }),
    monotonicNow: () => ownerWindow.performance.now(),
    wallClockNow: () => new ownerWindow.Date(),
    defer: (callback) => ownerWindow.queueMicrotask(callback),
    schedule: (callback, delayMs) => {
      const timeout = ownerWindow.setTimeout(callback, delayMs);
      return () => ownerWindow.clearTimeout(timeout);
    },
    writeClipboard: async (text) => {
      if (browserNavigator.clipboard === undefined) {
        throw new Error('Clipboard access is unavailable.');
      }
      await browserNavigator.clipboard.writeText(text);
    },
    createObjectUrl: ({ mimeType, text }) => ownerWindow.URL.createObjectURL(
      new ownerWindow.Blob([text], { type: mimeType }),
    ),
    revokeObjectUrl: (url) => ownerWindow.URL.revokeObjectURL(url),
    download: ({ filename, url }) => {
      const anchor = ownerDocument.createElement('a');
      anchor.download = filename;
      anchor.href = url;
      anchor.click();
      anchor.remove();
    },
  });
}

function frontendToolbarContributions(runtime: TFrontendRuntime): readonly TCanvasToolbarContribution[] {
  return Object.freeze([
    Object.freeze({
      kind: 'tool',
      id: 'ai-chat',
      label: 'AI Chat',
      Icon: Bot,
      shortcuts: Object.freeze([{ key: 'c', label: 'C' }]),
      toolId: 'widget',
    }),
    Object.freeze({
      kind: 'action',
      id: 'sidebar-toggle',
      label: 'Toggle sidebar',
      Icon: PanelLeft,
      shortcuts: Object.freeze([{
        key: 'b',
        label: 'Ctrl+B',
        primary: true,
      }]),
      placement: 'persistent',
      active: () => runtime.store.state.sidebarVisible,
      attention: () => !runtime.store.state.sidebarVisible,
      onActivate: () => runtime.store.set('sidebarVisible', (visible) => !visible),
    }),
  ] satisfies readonly TCanvasToolbarContribution[]);
}

function frontendExtensionLoaders(args: Readonly<{
  canvasId: string;
  navigate(path: string): void;
  previewAutomation: ReturnType<typeof createWidgetPreviewAutomation>;
  runtime: TFrontendRuntime;
}>): readonly TCanvasExtensionLoader[] {
  const aiChat = createAiChatCanvasExtensionLoaderDescriptor({
    createSessionId: () => args.runtime.ownerWindow.crypto.randomUUID(),
    async load(signal) {
      const [{ createFrontendAiChatExtension }] = await Promise.all([
        import('../chat/adapters'),
        import('@omnidraw/component-ai-chat/styles.css'),
      ]);
      signal.throwIfAborted();
      return createFrontendAiChatExtension(args.runtime, {
        canvasId: args.canvasId,
        navigate: args.navigate,
        ensureWidgetPreview: args.previewAutomation.ensure,
      });
    },
  });
  const widgets = Object.freeze({
    name: 'omnidraw.frontend-widgets',
    loadingLabel: 'Loading widget…',
    failureLabel: 'Widget failed to load.',
    match(node) {
      if (node.kind !== 'widget-frame') return false;
      const extension = fnReadCanvasWidgetExtension(node);
      return extension?.type === 'widget-instance'
        || extension?.type === 'widget-preview';
    },
    async load(signal) {
      const { createFrontendWidgetExtension } = await import(
        '../framework/feature/canvas-extension'
      );
      signal.throwIfAborted();
      return createFrontendWidgetExtension({
        runtime: args.runtime,
        invalidateWidgets: () => args.runtime.catalogInvalidation.invalidate('widgets'),
      });
    },
  }) satisfies TCanvasExtensionLoader;
  return Object.freeze([widgets, aiChat]);
}

export function createFrontendCanvasComposition(
  args: TCreateFrontendCanvasCompositionArgs,
): TFrontendCanvasComposition {
  const ownerWindow = args.ownerDocument.defaultView;
  if (ownerWindow === null) {
    throw new Error('Canvas composition requires a browser window.');
  }
  const diagnostics = createFrontendDiagnostics(
    args.ownerDocument,
    args.canvasId,
  );
  const stopDatabaseEvents = startFrontendDatabaseEvents(args.runtime, args.canvasId);
  const previewAutomation = createWidgetPreviewAutomation(args.runtime);
  const dependencies = Object.freeze({
    transport: createFrontendCanvasDocumentTransport(args.runtime),
    themeService: args.runtime.theme.service,
    image: createCanvasImagePort(args.runtime),
    notification: Object.freeze({
      showError: showErrorToast,
      showSuccess: showSuccessToast,
      showInfo: showToast,
    }),
    createId: () => ownerWindow.crypto.randomUUID(),
    wait: createBrowserWaitPort(ownerWindow),
    initialBootRecovery: createFrontendCanvasInitialBootRecovery(args.runtime),
    hostRetirement:
      args.runtime.canvasHostRetirement.registration,
    ...(diagnostics === undefined ? {} : { diagnostics }),
    extensions: Object.freeze([
      createFrontendWidgetPlacementExtension({
        runtime: args.runtime,
        placement: args.runtime.widgetPlacement,
        previewAutomation,
      }),
    ]),
    extensionLoaders: frontendExtensionLoaders({
      canvasId: args.canvasId,
      navigate: args.navigate,
      previewAutomation,
      runtime: args.runtime,
    }),
    toolbarContributions: frontendToolbarContributions(args.runtime),
  }) satisfies TCanvasDependencies;

  return Object.freeze({
    canvas: Object.freeze({ id: args.canvasId }),
    dependencies,
    dispose: () => {
      stopDatabaseEvents();
      diagnostics?.dispose();
    },
  });
}
