import type { Database } from '@tursodatabase/database';
import type * as fs from 'node:fs/promises';
import type path from 'node:path';

export type TMigrationResult = { warnings?: string[] };

export type TMigrationPortal = {
  db: Database;
  dataDir: string;
  fs: Pick<typeof fs, 'cp' | 'lstat' | 'mkdir' | 'readFile' | 'readdir' | 'readlink' | 'realpath' | 'rename' | 'rm' | 'rmdir' | 'symlink' | 'writeFile'>;
  path: typeof path;
  platform: NodeJS.Platform;
};

export type TMigration =
  | { type: 'sql'; name: string; path: string; legacyNames?: string[] }
  | {
      type: 'typescript';
      name: string;
      version: string;
      run: (portal: TMigrationPortal, args: Record<string, never>) => Promise<TMigrationResult>;
    };
