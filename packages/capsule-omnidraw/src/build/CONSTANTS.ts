import {
  OMNIDRAW_CAPSULE_ALLOWED_APIS,
  OMNIDRAW_CAPSULE_HOST_LIMITS,
  OMNIDRAW_CAPSULE_LIMITS,
} from '../contract/CONSTANTS';

export const OMNIDRAW_CAPSULE_BUILD_POLICY_ID = 'omnidraw-capsule-widget-v2';

export {
  OMNIDRAW_CAPSULE_ALLOWED_APIS,
  OMNIDRAW_CAPSULE_HOST_LIMITS,
  OMNIDRAW_CAPSULE_LIMITS,
};

export const OMNIDRAW_CAPSULE_BUILD_POLICY = Object.freeze({
  maxFiles: 1_024,
  maxFileBytes: 4 * 1024 * 1024,
  maxTotalBytes: 32 * 1024 * 1024,
  maxPathBytes: 256,
  maxPathDepth: 24,
  maxModules: 1_024,
  maxOutputBytes: 16 * 1024 * 1024,
  budgetCeilings: OMNIDRAW_CAPSULE_LIMITS,
});

export const OMNIDRAW_CAPSULE_ALLOWED_SERVER_IMPORTS = Object.freeze([
  '@omnidraw/sdk/server',
  'zod',
]);

export const OMNIDRAW_SERVER_ARTIFACT_FORMAT =
  'omnidraw.server-artifact.v1';
