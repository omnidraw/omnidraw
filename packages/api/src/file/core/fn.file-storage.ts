import type { TFileFormat } from "@omnidraw/service-db/model";

const mimeTypeToExtension = {
  "image/avif": "avif",
  "image/bmp": "bmp",
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/svg+xml": "svg",
  "image/tiff": "tif",
  "image/vnd.microsoft.icon": "ico",
  "image/webp": "webp",
  "image/x-icon": "ico",
} as const satisfies Partial<Record<TFileFormat, string>>;

const extensionToMimeType = {
  avif: "image/avif",
  bmp: "image/bmp",
  gif: "image/gif",
  ico: "image/vnd.microsoft.icon",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  svg: "image/svg+xml",
  tif: "image/tiff",
  tiff: "image/tiff",
  webp: "image/webp",
} as const satisfies Record<string, keyof typeof mimeTypeToExtension>;

export type TImageFormat = typeof extensionToMimeType[keyof typeof extensionToMimeType];

export function fnExtensionFromFormat(format: TFileFormat): string | null {
  return mimeTypeToExtension[format as keyof typeof mimeTypeToExtension] ?? null;
}

export function fnFormatFromExtension(extension: string): TImageFormat | null {
  return extensionToMimeType[extension.toLowerCase() as keyof typeof extensionToMimeType] ?? null;
}

export function fnToPublicFileUrl(fileName: string): string {
  return `/files/${fileName}`;
}

export function fnFileMetaFromPathname(pathname: string): { id: string; format: TImageFormat } | null {
  if (!pathname.startsWith("/files/")) return null;
  const fileName = pathname.slice("/files/".length);
  const match = fileName.match(/^([a-f0-9-]{36})\.([a-z0-9+]+)$/i);
  if (!match?.[1] || !match?.[2]) return null;

  const id = match[1];
  const extension = match[2];
  const format = fnFormatFromExtension(extension);
  if (!format) return null;

  return { id, format };
}