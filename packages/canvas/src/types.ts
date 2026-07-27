import type { ThemeService } from '@vibecanvas/service-theme';
import type { TBrowserTenantScope } from './fn.browser-tenant-scope';
import type { TCanvasDocumentTransport } from './services/CanvasDocumentService';

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

export type TCanvasToolbarGroup = Readonly<{
  name: string;
  json?: Readonly<{
    svgIcon?: string | null;
    lucidIcon?: string | null;
  }> | null;
}>;

export type TCanvasToolbarGroupsPort = Readonly<{
  list(): Promise<readonly TCanvasToolbarGroup[]>;
  subscribe(listener: () => void): () => void;
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
  image: TCanvasImagePort;
  toolbarGroups?: TCanvasToolbarGroupsPort;
  notification?: TCanvasNotificationPort;
}>;
