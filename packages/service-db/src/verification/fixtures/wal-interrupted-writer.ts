import { TURSO_ON_DISK_EXPERIMENTAL_FEATURES } from '../../DbServiceTurso/DbServiceTurso';
import { Database } from '../../DbServiceTurso/turso-native';

const databasePath = Bun.argv[2];
const readyPath = Bun.argv[3];

if (!databasePath || !readyPath) {
  throw new Error('Expected database and ready-marker paths.');
}

const database = new Database(databasePath, {
  experimental: [...TURSO_ON_DISK_EXPERIMENTAL_FEATURES],
});
type TImmediateTransaction = (() => Promise<void>) & { immediate: () => Promise<void> };
await database.connect();
await database.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;');
await database.exec('CREATE TABLE recovery_rows (id INTEGER PRIMARY KEY, value TEXT NOT NULL) STRICT;');
await (await database.prepare("INSERT INTO recovery_rows (id, value) VALUES (1, 'committed')")).run();

const interrupted = database.transaction(async () => {
  await (await database.prepare("INSERT INTO recovery_rows (id, value) VALUES (2, 'uncommitted')")).run();
  await Bun.write(readyPath, 'ready\n');
  await new Promise<never>(() => undefined);
}) as TImmediateTransaction;

await interrupted.immediate();
