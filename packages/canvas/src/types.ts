import type { ThemeService } from '@vibecanvas/service-theme';
import type { TBrowserTenantScope } from './fn.browser-tenant-scope';
import type { TCanvasDocumentTransport } from './services/CanvasDocumentService';
import type {
  TReproductionTraceDiagnostics,
  TReproductionTraceOwner,
} from './debug-trace/typed';

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

export type TCanvasRuntimeConfig = Readonly<{
  canvasId: string;
  tenant: TBrowserTenantScope;
  container: HTMLDivElement;
  transport: TCanvasDocumentTransport;
  createId(): string;
  onToggleSidebar(): void;
  themeService: ThemeService;
  initialGridVisible?: boolean;
  image: TCanvasImagePort;
  notification?: TCanvasNotificationPort;
  trace?: TReproductionTraceOwner | null;
}>;

export type TCanvasDiagnostics = TReproductionTraceDiagnostics;
