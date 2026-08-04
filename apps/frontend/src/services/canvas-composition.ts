import Bot from 'lucide-solid/icons/bot';
import PanelLeft from 'lucide-solid/icons/panel-left';
import type {
  TCanvasDependencies,
  TCanvasToolbarContribution,
  TCanvasWaitPort,
  TReproductionTraceOwner,
} from '@omnidraw/canvas';
import { createReproductionTrace } from '@omnidraw/canvas';
import type { TCanvasDescriptor } from '@omnidraw/canvas-contract';
import { showErrorToast, showSuccessToast, showToast } from '../components/ui/Toast';
import { setStore, store } from '../store';
import {
  canvasImagePort,
  createFrontendAiChatExtension,
} from '../ai-chat-adapters';
import { canvasDocumentTransport } from './canvas-document-transport';
import {
  frontendCanvasRuntimeRetirementCoordinator,
} from './canvas-runtime-retirement';
import { themeService } from './theme';

type TCreateFrontendCanvasCompositionArgs = Readonly<{
  canvasId: string;
  navigate(path: string): void;
  ownerDocument: Document;
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
      cangineVersion: '0.6.0',
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

function frontendToolbarContributions(): readonly TCanvasToolbarContribution[] {
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
      active: () => store.sidebarVisible,
      attention: () => !store.sidebarVisible,
      onActivate: () => setStore('sidebarVisible', (visible) => !visible),
    }),
  ] satisfies readonly TCanvasToolbarContribution[]);
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
  const runtimeExtension = createFrontendAiChatExtension({
    navigate: args.navigate,
  });
  const dependencies = Object.freeze({
    transport: canvasDocumentTransport,
    themeService,
    image: canvasImagePort,
    notification: Object.freeze({
      showError: showErrorToast,
      showSuccess: showSuccessToast,
      showInfo: showToast,
    }),
    createId: () => ownerWindow.crypto.randomUUID(),
    wait: createBrowserWaitPort(ownerWindow),
    runtimeRetirement:
      frontendCanvasRuntimeRetirementCoordinator.registration,
    ...(diagnostics === undefined ? {} : { diagnostics }),
    runtimeExtensions: Object.freeze([runtimeExtension]),
    toolbarContributions: frontendToolbarContributions(),
  }) satisfies TCanvasDependencies;

  return Object.freeze({
    canvas: Object.freeze({ id: args.canvasId }),
    dependencies,
    dispose: () => diagnostics?.dispose(),
  });
}
