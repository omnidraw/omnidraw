/**
 * @file Keeps the raw baseline SQL asset on the server-only migration boundary.
 */

/// <reference path="../assets.d.ts" />

import { DATABASE_SCHEMA_VERSION, INITIAL_MIGRATION_NAME } from '../CONSTANTS';
import initialMigrationPath from './000-initial.sql' with { type: 'file' };

const INITIAL_MIGRATION = Object.freeze({
  type: 'sql' as const,
  name: INITIAL_MIGRATION_NAME,
  version: DATABASE_SCHEMA_VERSION,
  path: initialMigrationPath,
});

export { INITIAL_MIGRATION };
