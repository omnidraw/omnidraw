import {
  PUBLICATION_MANIFEST_FILE,
  PUBLICATION_RELEASE_FILE,
} from './CONSTANTS';
import { WIDGET_SLUG_MAX_BYTES } from '@omnidraw/widget-contract/CONSTANTS';
import {
  fnNormalizeWidgetFilesystemRelativePath,
  fnUtf8ByteLength,
} from '@omnidraw/widget-contract/fn.filesystem-path';
import type {
  TAtomicPublicationInput,
  TMetadataPublicationInput,
  TPreparedPublicationFile,
  TPublicationDigestFence,
  TPublicationInputValidation,
  TPublicationRecoveryJournal,
  TPublicationTransition,
  TPublicationTransitionEvent,
  TPublicationWriterLockPurpose,
  TPublicationWriterLockRecord,
} from './typed';

const DIGEST_PATTERN = /^[a-f0-9]{64}$/;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{1,96}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function safeRuntimePath(path: string): boolean {
  if (fnNormalizeWidgetFilesystemRelativePath(path) !== path) return false;
  return path === 'capsule.artifact'
    || path === 'functions.json'
    || path.startsWith('dist/')
    || path.startsWith('server-dist/');
}

function parentDirectories(paths: readonly string[]): readonly string[] {
  const directories = new Set<string>();
  for (const path of paths) {
    const segments = path.split('/');
    for (let index = 1; index < segments.length; index += 1) {
      directories.add(segments.slice(0, index).join('/'));
    }
  }
  return Object.freeze([...directories].sort((left, right) => {
    const depth = left.split('/').length - right.split('/').length;
    return depth === 0 ? compareText(left, right) : depth;
  }));
}

export function fnIsPublicationSlug(value: string): boolean {
  return fnUtf8ByteLength(value) <= WIDGET_SLUG_MAX_BYTES && SLUG_PATTERN.test(value);
}

export function fnIsPublicationToken(value: string): boolean {
  return TOKEN_PATTERN.test(value);
}

export function fnIsPublicationDigest(value: string): boolean {
  return DIGEST_PATTERN.test(value);
}

export function fnIsMissingFilesystemError(error: unknown): boolean {
  return error instanceof Error
    && 'code' in error
    && (error as Error & { code?: unknown }).code === 'ENOENT';
}

export function fnIsAlreadyPresentFilesystemError(error: unknown): boolean {
  return error instanceof Error
    && 'code' in error
    && (error as Error & { code?: unknown }).code === 'EEXIST';
}

export function fnPublicationFenceMatches(
  expected: TPublicationDigestFence,
  observed: TPublicationDigestFence,
): boolean {
  return expected.draftDigestSha256 === observed.draftDigestSha256
    && expected.catalogDigestSha256 === observed.catalogDigestSha256;
}

export function fnPublicationStageName(slug: string, operationToken: string): string {
  return `${slug}.${operationToken}.stage`;
}

export function fnPublicationTrashName(slug: string, operationToken: string): string {
  return `${slug}.${operationToken}.replaced`;
}

export function fnPublicationJournalName(slug: string, operationToken: string): string {
  return `${slug}.${operationToken}.replacement.json`;
}

export function fnSerializePublicationWriterLock(
  ownerToken: string,
  purpose: TPublicationWriterLockPurpose,
): string {
  return `${JSON.stringify({
    format: 'omnidraw.widget-writer-lock.v1',
    ownerToken,
    purpose,
  } satisfies TPublicationWriterLockRecord)}\n`;
}

export function fnParsePublicationWriterLock(
  serialized: string,
): TPublicationWriterLockRecord | null {
  const value = parseJson(serialized);
  if (
    !isRecord(value)
    || !hasExactKeys(value, ['format', 'ownerToken', 'purpose'])
    || value.format !== 'omnidraw.widget-writer-lock.v1'
    || typeof value.ownerToken !== 'string'
    || !fnIsPublicationToken(value.ownerToken)
    || (
      value.purpose !== 'publish'
      && value.purpose !== 'metadata'
      && value.purpose !== 'draft'
      && value.purpose !== 'recover'
      && value.purpose !== 'import'
      && value.purpose !== 'preview'
    )
  ) return null;
  return Object.freeze({
    format: 'omnidraw.widget-writer-lock.v1',
    ownerToken: value.ownerToken,
    purpose: value.purpose,
  });
}

export function fnReleaseExecutableManifestDigest(serialized: string): string | null {
  const value = parseJson(serialized);
  if (
    !isRecord(value)
    || value.format !== 'omnidraw.widget-release.v1'
    || value.complete !== true
    || typeof value.executableManifestDigestSha256 !== 'string'
    || !fnIsPublicationDigest(value.executableManifestDigestSha256)
  ) return null;
  return value.executableManifestDigestSha256;
}

export function fnValidateMetadataPublicationInput(
  args: TMetadataPublicationInput,
): string | null {
  if (!fnIsPublicationSlug(args.slug)) return 'Widget slug is not safe lowercase kebab-case.';
  if (!fnIsPublicationToken(args.operationToken) || !fnIsPublicationToken(args.lockOwnerToken)) {
    return 'Metadata publication tokens are invalid.';
  }
  if (
    !fnIsPublicationDigest(args.expectedFence.draftDigestSha256)
    || !fnIsPublicationDigest(args.expectedFence.catalogDigestSha256)
    || !fnIsPublicationDigest(args.expectedExecutableManifestDigestSha256)
    || !fnIsPublicationDigest(args.newExecutableManifestDigestSha256)
  ) return 'Metadata publication digests must be lowercase SHA-256.';
  if (
    args.expectedExecutableManifestDigestSha256
    !== args.newExecutableManifestDigestSha256
  ) return 'Metadata publication changed executable manifest identity and requires a code build.';
  const manifest = parseJson(args.manifestJson);
  if (!isRecord(manifest) || manifest.slug !== args.slug) {
    return 'Authored manifest bytes do not match the folder slug.';
  }
  return null;
}

export function fnSerializePublicationJournal(
  journal: TPublicationRecoveryJournal,
): string {
  return `${JSON.stringify({
    format: 'omnidraw.widget-replacement.v1',
    slug: journal.slug,
    operationToken: journal.operationToken,
    stageName: journal.stageName,
    replacedName: journal.replacedName,
  })}\n`;
}

export function fnParsePublicationJournal(
  serialized: string,
): TPublicationRecoveryJournal | null {
  const value = parseJson(serialized);
  if (
    !isRecord(value)
    || !hasExactKeys(value, [
      'format',
      'slug',
      'operationToken',
      'stageName',
      'replacedName',
    ])
    || value.format !== 'omnidraw.widget-replacement.v1'
    || typeof value.slug !== 'string'
    || !fnIsPublicationSlug(value.slug)
    || typeof value.operationToken !== 'string'
    || !fnIsPublicationToken(value.operationToken)
    || typeof value.stageName !== 'string'
    || typeof value.replacedName !== 'string'
    || value.stageName !== fnPublicationStageName(value.slug, value.operationToken)
    || value.replacedName !== fnPublicationTrashName(value.slug, value.operationToken)
  ) return null;
  return Object.freeze({
    format: 'omnidraw.widget-replacement.v1',
    slug: value.slug,
    operationToken: value.operationToken,
    stageName: value.stageName,
    replacedName: value.replacedName,
  });
}

export function fnCreatePublicationTransitionEvent(args: Readonly<{
  timing: 'before' | 'after';
  transition: TPublicationTransition;
  slug: string;
  operationToken: string;
  path?: string | null;
}>): TPublicationTransitionEvent {
  return Object.freeze({
    format: 'omnidraw.widget-publication-transition.v1',
    timing: args.timing,
    transition: args.transition,
    slug: args.slug,
    operationToken: args.operationToken,
    path: args.path ?? null,
  });
}

export function fnValidateAtomicPublicationInput(
  args: TAtomicPublicationInput,
): TPublicationInputValidation {
  if (!fnIsPublicationSlug(args.slug)) {
    return { valid: false, reason: 'Widget slug is not safe lowercase kebab-case.' };
  }
  if (!fnIsPublicationToken(args.operationToken) || !fnIsPublicationToken(args.lockOwnerToken)) {
    return { valid: false, reason: 'Publication tokens are invalid.' };
  }
  if (
    !fnIsPublicationDigest(args.expectedFence.draftDigestSha256)
    || !fnIsPublicationDigest(args.expectedFence.catalogDigestSha256)
  ) return { valid: false, reason: 'Expected publication digests must be lowercase SHA-256.' };

  const manifest = parseJson(args.manifestJson);
  if (!isRecord(manifest) || manifest.slug !== args.slug) {
    return { valid: false, reason: 'Authored manifest bytes do not match the folder slug.' };
  }
  const release = parseJson(args.releaseJson);
  if (
    !isRecord(release)
    || release.format !== 'omnidraw.widget-release.v1'
    || release.complete !== true
    || !Array.isArray(release.files)
  ) return { valid: false, reason: 'release.json is not a complete v1 release descriptor.' };

  const caseFoldedPaths = new Set<string>();
  const files: TPreparedPublicationFile[] = [];
  for (const file of args.files) {
    if (
      file.path === PUBLICATION_MANIFEST_FILE
      || file.path === PUBLICATION_RELEASE_FILE
      || !safeRuntimePath(file.path)
    ) return { valid: false, reason: `Unsafe publication file path '${file.path}'.` };
    const folded = file.path.toLowerCase();
    if (caseFoldedPaths.has(folded)) {
      return { valid: false, reason: `Duplicate or case-colliding publication path '${file.path}'.` };
    }
    caseFoldedPaths.add(folded);
    files.push(Object.freeze({
      path: file.path,
      bytes: typeof file.bytes === 'string' ? file.bytes : file.bytes.slice(),
    }));
  }
  if (!caseFoldedPaths.has('capsule.artifact')) {
    return { valid: false, reason: 'Publication is missing capsule.artifact.' };
  }
  if (![...caseFoldedPaths].some((path) => path.startsWith('dist/'))) {
    return { valid: false, reason: 'Publication is missing browser distribution files.' };
  }

  const releasePaths = new Set<string>();
  for (const file of release.files) {
    if (!isRecord(file) || typeof file.path !== 'string' || !safeRuntimePath(file.path)) {
      return { valid: false, reason: 'release.json contains an unsafe runtime file path.' };
    }
    const folded = file.path.toLowerCase();
    if (releasePaths.has(folded)) {
      return { valid: false, reason: 'release.json contains duplicate or case-colliding files.' };
    }
    releasePaths.add(folded);
  }
  if (
    releasePaths.size !== caseFoldedPaths.size
    || [...releasePaths].some((path) => !caseFoldedPaths.has(path))
  ) return { valid: false, reason: 'Prepared runtime files do not match the release file set.' };

  files.sort((left, right) => compareText(left.path, right.path));
  return Object.freeze({
    valid: true,
    files: Object.freeze(files),
    directories: parentDirectories(files.map((file) => file.path)),
  });
}
