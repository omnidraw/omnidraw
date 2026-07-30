/** @file Keeps ordered raw SQL assets on the server-only migration boundary. */

/// <reference path="../assets.d.ts" />

import {
  AGENT_AUTHORING_MIGRATION_NAME,
  AGENT_AUTHORING_MIGRATION_VERSION,
  INITIAL_MIGRATION_NAME,
  INITIAL_MIGRATION_VERSION,
  LIVE_WIDGET_PREVIEW_MIGRATION_NAME,
  LIVE_WIDGET_PREVIEW_MIGRATION_VERSION,
  CAPSULE_API_GROUPS_MIGRATION_NAME,
  CAPSULE_API_GROUPS_MIGRATION_VERSION,
  FUNCTION_RUNTIME_MIGRATION_NAME,
  FUNCTION_RUNTIME_MIGRATION_VERSION,
  PREVIEW_SOURCE_MAPS_MIGRATION_NAME,
  PREVIEW_SOURCE_MAPS_MIGRATION_VERSION,
  WIDGET_REVISION_SEQUENCE_MIGRATION_NAME,
  WIDGET_REVISION_SEQUENCE_MIGRATION_VERSION,
} from '../CONSTANTS';
import agentAuthoringMigrationPath from './003-agent-authoring.sql' with { type: 'file' };
import initialMigrationPath from './000-initial.sql' with { type: 'file' };
import liveWidgetPreviewMigrationPath from './004-live-widget-preview.sql' with { type: 'file' };
import capsuleApiGroupsMigrationPath from './005-capsule-api-groups.sql' with { type: 'file' };
import widgetRevisionSequenceMigrationPath from './001-widget-revision-sequence.sql' with { type: 'file' };
import functionRuntimeMigrationPath from './002-function-runtime.sql' with { type: 'file' };
import previewSourceMapsMigrationPath from './006-preview-source-maps.sql' with { type: 'file' };

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

const AGENT_AUTHORING_MIGRATION = Object.freeze({
  type: 'sql' as const,
  name: AGENT_AUTHORING_MIGRATION_NAME,
  version: AGENT_AUTHORING_MIGRATION_VERSION,
  path: agentAuthoringMigrationPath,
});

const LIVE_WIDGET_PREVIEW_MIGRATION = Object.freeze({
  type: 'sql' as const,
  name: LIVE_WIDGET_PREVIEW_MIGRATION_NAME,
  version: LIVE_WIDGET_PREVIEW_MIGRATION_VERSION,
  path: liveWidgetPreviewMigrationPath,
});

const CAPSULE_API_GROUPS_MIGRATION = Object.freeze({
  type: 'sql' as const,
  name: CAPSULE_API_GROUPS_MIGRATION_NAME,
  version: CAPSULE_API_GROUPS_MIGRATION_VERSION,
  path: capsuleApiGroupsMigrationPath,
});

const PREVIEW_SOURCE_MAPS_MIGRATION = Object.freeze({
  type: 'sql' as const,
  name: PREVIEW_SOURCE_MAPS_MIGRATION_NAME,
  version: PREVIEW_SOURCE_MAPS_MIGRATION_VERSION,
  path: previewSourceMapsMigrationPath,
});

const MIGRATION_FILES = Object.freeze([
  INITIAL_MIGRATION,
  WIDGET_REVISION_SEQUENCE_MIGRATION,
  FUNCTION_RUNTIME_MIGRATION,
  AGENT_AUTHORING_MIGRATION,
  LIVE_WIDGET_PREVIEW_MIGRATION,
  CAPSULE_API_GROUPS_MIGRATION,
  PREVIEW_SOURCE_MAPS_MIGRATION,
]);

export {
  AGENT_AUTHORING_MIGRATION,
  INITIAL_MIGRATION,
  FUNCTION_RUNTIME_MIGRATION,
  LIVE_WIDGET_PREVIEW_MIGRATION,
  CAPSULE_API_GROUPS_MIGRATION,
  PREVIEW_SOURCE_MAPS_MIGRATION,
  MIGRATION_FILES,
  WIDGET_REVISION_SEQUENCE_MIGRATION,
};
