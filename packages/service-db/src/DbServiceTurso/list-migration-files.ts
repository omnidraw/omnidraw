import { MIGRATION_FILES } from '../migrations/CONSTANTS';
import type { TMigration } from './migration-types';

function listMigrationFiles(): readonly TMigration[] {
  return MIGRATION_FILES;
}

export { listMigrationFiles };
