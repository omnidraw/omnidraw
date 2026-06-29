/* eslint-disable functional-core/import-boundary -- legacy pure helper depends on node path parsing */
import { extname } from 'path';
import type { TFilesystemFileKind } from '@vibecanvas/service-filesystem/types';

const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.mdx', '.json', '.js', '.jsx', '.ts', '.tsx', '.css', '.scss', '.html', '.yml', '.yaml', '.xml', '.svg', '.toml', '.env', '.gitignore', '.npmrc'
]);
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.avif']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.webm', '.mkv', '.avi']);
const PDF_EXTENSIONS = new Set(['.pdf']);

function fnDetectFileKind(path: string): TFilesystemFileKind {
  const extension = extname(path).toLowerCase();

  if (PDF_EXTENSIONS.has(extension)) return 'pdf';
  if (IMAGE_EXTENSIONS.has(extension)) return 'image';
  if (VIDEO_EXTENSIONS.has(extension)) return 'video';
  if (TEXT_EXTENSIONS.has(extension)) return 'text';

  return 'binary';
}

export { fnDetectFileKind };
