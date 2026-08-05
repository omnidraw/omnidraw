/**
 * @file Strict parsers for portable manifest v1 and generated release metadata.
 */

import { z } from 'zod';
import {
  WIDGET_DESCRIPTION_MAX_CHARACTERS,
  WIDGET_MANIFEST_V1_SCHEMA_URL,
  WIDGET_NAME_MAX_CHARACTERS,
  WIDGET_RELEASE_FILE_COUNT_MAX,
  WIDGET_RELEASE_FILE_MAX_BYTES,
  WIDGET_RELEASE_FORMAT,
  WIDGET_SLUG_MAX_BYTES,
  WIDGET_TOOL_GROUP_MAX_BYTES,
  WIDGET_TOOL_LABEL_MAX_CHARACTERS,
} from '../CONSTANTS';
import {
  fnNormalizeWidgetExecutableProjection,
  fnNormalizeWidgetManifestV1,
} from '../core/fn.filesystem-manifest';
import {
  fnNormalizeWidgetFilesystemRelativePath,
  fnUtf8ByteLength,
  fnWidgetToolIconTextError,
} from '../core/fn.filesystem-path';
import {
  ZWidgetCapsuleApis,
  ZWidgetCapsuleBudgetRequest,
  ZWidgetResourceRequirement,
} from '../manifest-schema';
import { ZWidgetCapsuleRuntimeDescriptor } from '../runtime-descriptor-schema';
import { ZOmnidrawToolIcon } from '../tool-icon';
import type {
  TWidgetExecutableManifestProjection,
  TWidgetManifestV1,
  TWidgetReleaseDescriptor,
  TWidgetUnsignedReleaseDescriptor,
} from './typed';

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const CAPSULE_HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TARGET_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:+/-]{0,99}$/;
const BUILD_ENTRY_PATTERN = /\.(?:[cm]?[jt]sx?)$/;

const ZSha256 = z.string().regex(SHA256_PATTERN);
const ZCapsuleHash = z.string().regex(CAPSULE_HASH_PATTERN);

const ZWidgetSlug = z.string().min(1).max(WIDGET_SLUG_MAX_BYTES).regex(SLUG_PATTERN)
  .refine((value) => fnUtf8ByteLength(value) <= WIDGET_SLUG_MAX_BYTES);

const ZWidgetGroup = z.union([
  z.string().min(1).max(WIDGET_TOOL_GROUP_MAX_BYTES).regex(SLUG_PATTERN)
    .refine((value) => fnUtf8ByteLength(value) <= WIDGET_TOOL_GROUP_MAX_BYTES),
  z.null(),
]);

const ZWidgetManifestV1BuildEntry = z.string().superRefine((value, context) => {
  if (fnNormalizeWidgetFilesystemRelativePath(value) === null) {
    context.addIssue({ code: 'custom', message: 'Expected a safe relative widget entry path' });
  }
  if (!BUILD_ENTRY_PATTERN.test(value)) {
    context.addIssue({ code: 'custom', message: 'Widget entries must use a JavaScript or TypeScript extension' });
  }
}).transform((value) => fnNormalizeWidgetFilesystemRelativePath(value)!);

const ZWidgetManifestV1ToolIcon = ZOmnidrawToolIcon.superRefine((icon, context) => {
  if (icon.svgIcon === undefined) return;
  const error = fnWidgetToolIconTextError(icon.svgIcon);
  if (error !== null) context.addIssue({ code: 'custom', message: error, path: ['svgIcon'] });
});

const ZWidgetManifestV1Shape = z.object({
  $schema: z.literal(WIDGET_MANIFEST_V1_SCHEMA_URL),
  schemaVersion: z.literal(1),
  name: z.string().trim().min(1).max(WIDGET_NAME_MAX_CHARACTERS),
  slug: ZWidgetSlug,
  description: z.string().trim().min(1).max(WIDGET_DESCRIPTION_MAX_CHARACTERS),
  tool: z.object({
    label: z.string().trim().min(1).max(WIDGET_TOOL_LABEL_MAX_CHARACTERS),
    icon: ZWidgetManifestV1ToolIcon.optional(),
    group: ZWidgetGroup,
    priority: z.number().int().min(-1_000).max(1_000),
  }).strict(),
  ui: z.object({
    runtime: z.literal('capsule'),
    entry: ZWidgetManifestV1BuildEntry,
    apis: ZWidgetCapsuleApis,
    budgets: ZWidgetCapsuleBudgetRequest.optional(),
    state: z.object({
      collaborative: z.boolean(),
      localStore: z.enum(['none', 'ephemeral']),
    }).strict().optional(),
    parkability: z.object({ enabled: z.literal(false) }).strict().optional(),
  }).strict(),
  server: z.object({
    entry: ZWidgetManifestV1BuildEntry,
    runtimeAbi: z.string().min(1).max(100).regex(TARGET_ID_PATTERN),
  }).strict().optional(),
  resources: z.array(ZWidgetResourceRequirement).max(64).superRefine((resources, context) => {
    const slots = new Set<string>();
    resources.forEach((requirement, index) => {
      if (slots.has(requirement.slot)) {
        context.addIssue({
          code: 'custom',
          message: `Duplicate resource slot: ${requirement.slot}`,
          path: [index, 'slot'],
        });
      }
      slots.add(requirement.slot);
    });
  }).optional(),
}).strict();

export const ZWidgetManifestV1: z.ZodType<TWidgetManifestV1> = ZWidgetManifestV1Shape
  .transform((manifest) => fnNormalizeWidgetManifestV1(manifest));

const ZWidgetExecutableUi = z.object({
  runtime: z.literal('capsule'),
  entry: ZWidgetManifestV1BuildEntry,
  apis: ZWidgetCapsuleApis,
  budgets: ZWidgetCapsuleBudgetRequest.optional(),
  state: z.object({
    collaborative: z.boolean(),
    localStore: z.enum(['none', 'ephemeral']),
  }).strict().optional(),
  parkability: z.object({ enabled: z.literal(false) }).strict().optional(),
}).strict();

const ZWidgetExecutableServer = z.object({
  entry: ZWidgetManifestV1BuildEntry,
  runtimeAbi: z.string().min(1).max(100).regex(TARGET_ID_PATTERN),
}).strict();

/** Strict parser for the build-time executable projection of manifest v1. */
export const ZWidgetExecutableManifest: z.ZodType<TWidgetExecutableManifestProjection> = z.object({
  schemaVersion: z.literal(1),
  ui: ZWidgetExecutableUi,
  server: ZWidgetExecutableServer.nullable(),
  resources: z.array(ZWidgetResourceRequirement).max(64).superRefine((resources, context) => {
    const slots = new Set<string>();
    resources.forEach((requirement, index) => {
      if (slots.has(requirement.slot)) {
        context.addIssue({
          code: 'custom',
          message: `Duplicate resource slot: ${requirement.slot}`,
          path: [index, 'slot'],
        });
      }
      slots.add(requirement.slot);
    });
  }),
}).strict()
  .transform((projection) => fnNormalizeWidgetExecutableProjection(projection));

const ZWidgetReleaseRuntimePath = z.string().superRefine((value, context) => {
  const normalized = fnNormalizeWidgetFilesystemRelativePath(value);
  if (
    normalized === null
    || !(
      normalized === 'capsule.artifact'
      || normalized === 'functions.json'
      || normalized.startsWith('dist/')
      || normalized.startsWith('server-dist/')
    )
  ) context.addIssue({ code: 'custom', message: 'Expected a managed published runtime path' });
});

const ZWidgetReleaseFile = z.object({
  path: ZWidgetReleaseRuntimePath,
  byteSize: z.number().int().min(0).max(WIDGET_RELEASE_FILE_MAX_BYTES),
  sha256: ZSha256,
}).strict();

const ZWidgetUnsignedReleaseDescriptorShape = z.object({
  format: z.literal(WIDGET_RELEASE_FORMAT),
  complete: z.literal(true),
  executableManifestDigestSha256: ZSha256,
  files: z.array(ZWidgetReleaseFile).min(2).max(WIDGET_RELEASE_FILE_COUNT_MAX),
  capsule: z.object({
    path: z.literal('capsule.artifact'),
    artifactHash: ZCapsuleHash.transform((value) => value as `sha256:${string}`),
    runtime: ZWidgetCapsuleRuntimeDescriptor,
  }).strict(),
  server: z.object({
    entry: ZWidgetReleaseRuntimePath.refine((value) => value.startsWith('server-dist/')),
    runtimeAbi: z.string().min(1).max(100).regex(TARGET_ID_PATTERN),
    functionsPath: z.literal('functions.json'),
    serverDistDigestSha256: ZSha256,
    functionsDigestSha256: ZSha256,
  }).strict().nullable(),
}).strict();

export const ZWidgetUnsignedReleaseDescriptor: z.ZodType<TWidgetUnsignedReleaseDescriptor> =
  ZWidgetUnsignedReleaseDescriptorShape;

export const ZWidgetReleaseDescriptor: z.ZodType<TWidgetReleaseDescriptor> =
  ZWidgetUnsignedReleaseDescriptorShape.extend({
    releaseAttestation: z.object({
      algorithm: z.literal('Ed25519'),
      keyId: z.string().min(1).max(170).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
      signatureBase64: z.string().length(88).regex(/^[A-Za-z0-9+/]{86}==$/),
    }).strict(),
  }).strict();

export function parseWidgetManifestV1Json(value: string): TWidgetManifestV1 {
  if (fnUtf8ByteLength(value) > 128 * 1_024) {
    throw new TypeError('omnidraw.json exceeds the 128 KiB manifest limit.');
  }
  return ZWidgetManifestV1.parse(JSON.parse(value));
}

export function parseWidgetReleaseJson(value: string): TWidgetReleaseDescriptor {
  if (fnUtf8ByteLength(value) > 2 * 1_024 * 1_024) {
    throw new TypeError('release.json exceeds the 2 MiB descriptor limit.');
  }
  return ZWidgetReleaseDescriptor.parse(JSON.parse(value));
}
