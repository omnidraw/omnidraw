import { INITIAL_MIGRATION } from '../migrations/CONSTANTS';
import type { TMigration } from './migration-types';

const migrationFiles = Object.freeze<TMigration[]>([
  INITIAL_MIGRATION,
]);

function listMigrationFiles(): readonly TMigration[] {
  return migrationFiles;
}

export { listMigrationFiles };
