/**
 * @file Hold a multiprocess WAL connection open for coordinator-healing tests.
 */
import { writeFile } from 'node:fs/promises';
import { TURSO_ON_DISK_EXPERIMENTAL_FEATURES } from '../../DbServiceTurso/DbServiceTurso';
import { Database } from '../../DbServiceTurso/turso-native';

const databasePath = Bun.argv[2];
const readyPath = Bun.argv[3];
if (!databasePath || !readyPath) {
  throw new Error('Usage: multiprocess-wal-holder.ts <database-path> <ready-path>');
}

const database = new Database(databasePath, {
  fileMustExist: true,
  experimental: [...TURSO_ON_DISK_EXPERIMENTAL_FEATURES],
});
await database.connect();
await writeFile(readyPath, 'ready');
await new Promise(() => {});
