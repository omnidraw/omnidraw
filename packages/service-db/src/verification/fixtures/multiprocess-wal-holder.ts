/**
 * @file Hold a multiprocess WAL connection open for coordinator-healing tests.
 */
import { writeFile } from 'node:fs/promises';
import { Database } from '../../DbServiceTurso/turso-native';

const databasePath = Bun.argv[2];
const readyPath = Bun.argv[3];
if (!databasePath || !readyPath) {
  throw new Error('Usage: multiprocess-wal-holder.ts <database-path> <ready-path>');
}

const database = new Database(databasePath, {
  fileMustExist: true,
  experimental: [
    'custom_types',
    'triggers',
    'index_method',
    'generated_columns',
    'multiprocess_wal',
  ] as never,
});
await database.connect();
await writeFile(readyPath, 'ready');
await new Promise(() => {});
