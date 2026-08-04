/** @file Keeps ordered raw SQL assets on the server-only migration boundary. */

/// <reference path="../assets.d.ts" />

import {
  INITIAL_MIGRATION_NAME,
  INITIAL_MIGRATION_VERSION,
} from '../CONSTANTS';
import initialMigrationPath from './000-initial.sql' with { type: 'file' };

const INITIAL_MIGRATION = Object.freeze({
  type: 'sql' as const,
  name: INITIAL_MIGRATION_NAME,
  version: INITIAL_MIGRATION_VERSION,
  path: initialMigrationPath,
});

const MIGRATION_FILES = Object.freeze([
  INITIAL_MIGRATION,
]);

export {
  INITIAL_MIGRATION,
  MIGRATION_FILES,
};
