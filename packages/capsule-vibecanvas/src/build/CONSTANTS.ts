import {
  VIBECANVAS_CAPSULE_ALLOWED_APIS,
  VIBECANVAS_CAPSULE_HOST_LIMITS,
  VIBECANVAS_CAPSULE_LIMITS,
} from '../contract/CONSTANTS';

export const VIBECANVAS_CAPSULE_BUILD_POLICY_ID = 'vibecanvas-capsule-widget-v2';

export {
  VIBECANVAS_CAPSULE_ALLOWED_APIS,
  VIBECANVAS_CAPSULE_HOST_LIMITS,
  VIBECANVAS_CAPSULE_LIMITS,
};

export const VIBECANVAS_CAPSULE_BUILD_POLICY = Object.freeze({
  maxFiles: 1_024,
  maxFileBytes: 4 * 1024 * 1024,
  maxTotalBytes: 32 * 1024 * 1024,
  maxPathBytes: 256,
  maxPathDepth: 24,
  maxModules: 1_024,
  maxOutputBytes: 16 * 1024 * 1024,
  budgetCeilings: VIBECANVAS_CAPSULE_LIMITS,
});

export const VIBECANVAS_CAPSULE_ALLOWED_SERVER_IMPORTS = Object.freeze([
  '@vibecanvas/sdk/server',
  'zod',
]);

export const VIBECANVAS_SERVER_ARTIFACT_FORMAT =
  'vibecanvas.server-artifact.v1';
