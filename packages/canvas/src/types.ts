import type {
  TCanvasDescriptor,
  TCanvasDocumentTransport,
} from '@omnidraw/canvas-contract';
import type { IThemeService } from '@omnidraw/theme';
import type {
  TReproductionTraceOwner,
} from './debug-trace/typed';
import type { ICanvasExtension } from './extension';
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

/**
 * Optional host-owned classification and connection-generation wait used only
 * when the first authoritative snapshot fails. Returning null makes the
 * failure terminal; a returned handle must settle promptly when cancelled.
 */
export type TCanvasInitialBootRecoveryPort = Readonly<{
  waitForRecovery(error: unknown): TCanvasWaitHandle | null;
}>;

/** Optional host-owned diagnostics capability consumed by canvas UI/runtime. */
export type TCanvasDiagnosticsPort = TReproductionTraceOwner;

/** One mounted Canvas retirement registered with its owning host. */
export type TCanvasHostRetirement = () => Promise<void>;

/**
 * Optional host lifecycle boundary used to await complete canvas shutdown
 * before the host retires its injected infrastructure.
 */
export type TCanvasHostRetirementPort = Readonly<{
  register(retire: TCanvasHostRetirement): () => void;
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
  initialBootRecovery?: TCanvasInitialBootRecoveryPort;
  diagnostics?: TCanvasDiagnosticsPort | null;
  hostRetirement?: TCanvasHostRetirementPort;
  extensions?: readonly ICanvasExtension[];
  toolbarContributions?: readonly TCanvasToolbarContribution[];
}>;

/** Minimal public composition boundary for the Solid canvas host. */
export type TCanvasProps = Readonly<{
  canvas: TCanvasDescriptor;
  /** Opaque stable identity for the host-owned capability scope. */
  hostScopeKey: string;
  dependencies: TCanvasDependencies;
}>;

export type TCanvasDiagnostics = TCanvasDiagnosticsPort;

export type {
  TCanvasKeyboardShortcut,
  TCanvasToolbarActionContribution,
  TCanvasToolbarContribution,
  TCanvasToolbarToolContribution,
} from './components/FloatingCanvasToolbar/toolbar.types';
