/* eslint-disable functional-core/export-shape -- legacy public helper name is part of the API contract */
const ptyImageFormatToExtension = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
} as const;

export type TPtyImageFormat = keyof typeof ptyImageFormatToExtension;

export function fxExtensionFromPtyImageFormat(format: TPtyImageFormat): string {
  return ptyImageFormatToExtension[format];
}
