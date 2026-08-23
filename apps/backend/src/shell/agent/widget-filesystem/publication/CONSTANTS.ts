import type { TPublicationTransition } from './typed';

export const PUBLICATION_DIRECTORY_MODE = 0o700;
export const PUBLICATION_FILE_MODE = 0o600;
export const PUBLICATION_LOCK_FILE = '.writer.lock';
export const PUBLICATION_RELEASE_FILE = 'release.json';
export const PUBLICATION_MANIFEST_FILE = 'omnidraw.json';
export const PUBLICATION_RECOVERY_SCAN_SCOPE = '$publication-recovery-scan';

export const PUBLICATION_MANAGED_DIRECTORIES = Object.freeze([
  'published',
  '.staging',
  '.trash',
  '.quarantine',
] as const);

export const PUBLICATION_TRANSITIONS = Object.freeze([
  'lock-create',
  'lock-remove',
  'directory-create',
  'stage-file-write',
  'release-write',
  'journal-write',
  'journal-remove',
  'metadata-file-write',
  'metadata-to-current',
  'metadata-rollback-to-current',
  'metadata-reopen-validation',
  'file-sync',
  'directory-sync',
  'stage-reopen-validation',
  'replaced-reopen-validation',
  'current-to-trash',
  'stage-to-current',
  'current-to-quarantine',
  'trash-to-current',
  'current-reopen-validation',
] satisfies readonly TPublicationTransition[]);
