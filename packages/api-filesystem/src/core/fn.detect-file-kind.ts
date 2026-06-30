import type { TFilesystemFileKind } from '@vibecanvas/service-filesystem/types';

const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.mdx', '.json', '.js', '.jsx', '.ts', '.tsx', '.css', '.scss', '.html', '.yml', '.yaml', '.xml', '.svg', '.toml', '.env', '.gitignore', '.npmrc'
]);
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.avif']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.webm', '.mkv', '.avi']);
const PDF_EXTENSIONS = new Set(['.pdf']);

function fnExtensionFromPath(path: string): string {
  const fileName = path.split(/[\\/]/).pop() ?? "";
  const dotIndex = fileName.lastIndexOf(".");
  return dotIndex >= 0 ? fileName.slice(dotIndex).toLowerCase() : "";
}

function fnDetectFileKind(path: string): TFilesystemFileKind {
  const extension = fnExtensionFromPath(path);

  if (PDF_EXTENSIONS.has(extension)) return 'pdf';
  if (IMAGE_EXTENSIONS.has(extension)) return 'image';
  if (VIDEO_EXTENSIONS.has(extension)) return 'video';
  if (TEXT_EXTENSIONS.has(extension)) return 'text';

  return 'binary';
}

export { fnDetectFileKind };
