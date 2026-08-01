import type {
  TCanvasDescriptor,
  TCanvasDocumentTransport,
} from '@omnidraw/canvas-contract';
import type { IThemeService } from '@omnidraw/service-theme';
import type {
  TReproductionTraceOwner,
} from './debug-trace/typed';
import type { ICanvasRuntimeExtension } from './extension';
import type {
  TCanvasToolbarContribution,
} from './components/FloatingCanvasToolbar/toolbar.types';

export type TImageUploadFormat =
  | 'image/jpeg'
  | 'image/png'
  | 'image/gif'
  | 'image/webp';

export type TCanvasImagePort = Readonly<{
  uploadImage(body: Readonly<{
    data: Uint8Array;
    mime_type: TImageUploadFormat;
  }>): Promise<Readonly<{ url: string }>>;
  cloneImage(body: Readonly<{ url: string }>): Promise<Readonly<{ url: string }>>;
  deleteImage(body: Readonly<{ url: string }>): Promise<Readonly<{ ok: true }>>;
}>;

export type TCanvasNotificationPort = Readonly<{
  showSuccess(title: string, description?: string): void;
  showError(title: string, description?: string): void;
  showInfo(title: string, description?: string): void;
}>;

/**
 * One host-owned delay. Cancelling it must promptly settle `promise` so a
 * disposed document client cannot remain parked in a retry delay.
 */
export type TCanvasWaitHandle = Readonly<{
  promise: Promise<void>;
  cancel(): void;
}>;

/** Host scheduling boundary used for reconnect and recovery delays. */
export type TCanvasWaitPort = Readonly<{
  wait(delayMs: number): TCanvasWaitHandle;
}>;

/** Optional host-owned diagnostics capability consumed by canvas UI/runtime. */
export type TCanvasDiagnosticsPort = TReproductionTraceOwner;

/** One mounted canvas runtime retirement registered with its owning host. */
export type TCanvasRuntimeRetirement = () => Promise<void>;

/**
 * Optional host lifecycle boundary used to await complete canvas shutdown
 * before the host retires tenant-scoped infrastructure.
 */
export type TCanvasRuntimeRetirementPort = Readonly<{
  register(retire: TCanvasRuntimeRetirement): () => void;
}>;

/**
 * All stateful or product-owned capabilities needed by one canvas instance.
 * The host constructs this bundle and retains ownership of injected ports.
 */
export type TCanvasDependencies = Readonly<{
  transport: TCanvasDocumentTransport;
  themeService: IThemeService;
  image: TCanvasImagePort;
  notification: TCanvasNotificationPort;
  createId(): string;
  wait: TCanvasWaitPort;
  diagnostics?: TCanvasDiagnosticsPort | null;
  runtimeRetirement?: TCanvasRuntimeRetirementPort;
  runtimeExtensions?: readonly ICanvasRuntimeExtension[];
  toolbarContributions?: readonly TCanvasToolbarContribution[];
}>;

/** Minimal public composition boundary for the Solid canvas host. */
export type TCanvasProps = Readonly<{
  canvas: TCanvasDescriptor;
  hostScopeKey: string;
  dependencies: TCanvasDependencies;
}>;

export type TCanvasRuntimeConfig = Readonly<{
  canvasId: string;
  container: HTMLDivElement;
  transport: TCanvasDocumentTransport;
  createId(): string;
  wait: TCanvasWaitPort;
  themeService: IThemeService;
  initialGridVisible?: boolean;
  image: TCanvasImagePort;
  notification: TCanvasNotificationPort;
  trace?: TReproductionTraceOwner | null;
}>;

export type TCanvasDiagnostics = TCanvasDiagnosticsPort;

export type {
  TCanvasKeyboardShortcut,
  TCanvasToolbarActionContribution,
  TCanvasToolbarContribution,
  TCanvasToolbarToolContribution,
} from './components/FloatingCanvasToolbar/toolbar.types';
