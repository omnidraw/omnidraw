/** @file Keeps ordered raw SQL assets on the server-only migration boundary. */

/// <reference path="../assets.d.ts" />

import {
  INITIAL_MIGRATION_NAME,
  INITIAL_MIGRATION_VERSION,
  FUNCTION_RUNTIME_MIGRATION_NAME,
  FUNCTION_RUNTIME_MIGRATION_VERSION,
  WIDGET_REVISION_SEQUENCE_MIGRATION_NAME,
  WIDGET_REVISION_SEQUENCE_MIGRATION_VERSION,
} from '../CONSTANTS';
import initialMigrationPath from './000-initial.sql' with { type: 'file' };
import widgetRevisionSequenceMigrationPath from './001-widget-revision-sequence.sql' with { type: 'file' };
import functionRuntimeMigrationPath from './002-function-runtime.sql' with { type: 'file' };

const INITIAL_MIGRATION = Object.freeze({
  type: 'sql' as const,
  name: INITIAL_MIGRATION_NAME,
  version: INITIAL_MIGRATION_VERSION,
  path: initialMigrationPath,
});

const WIDGET_REVISION_SEQUENCE_MIGRATION = Object.freeze({
  type: 'sql' as const,
  name: WIDGET_REVISION_SEQUENCE_MIGRATION_NAME,
  version: WIDGET_REVISION_SEQUENCE_MIGRATION_VERSION,
  path: widgetRevisionSequenceMigrationPath,
});

const FUNCTION_RUNTIME_MIGRATION = Object.freeze({
  type: 'sql' as const,
  name: FUNCTION_RUNTIME_MIGRATION_NAME,
  version: FUNCTION_RUNTIME_MIGRATION_VERSION,
  path: functionRuntimeMigrationPath,
});

const MIGRATION_FILES = Object.freeze([
  INITIAL_MIGRATION,
  WIDGET_REVISION_SEQUENCE_MIGRATION,
  FUNCTION_RUNTIME_MIGRATION,
]);

export {
  INITIAL_MIGRATION,
  FUNCTION_RUNTIME_MIGRATION,
  MIGRATION_FILES,
  WIDGET_REVISION_SEQUENCE_MIGRATION,
};
