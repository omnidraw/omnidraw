import {
  fnIsMissingFilesystemError,
  fnParsePublicationJournal,
  fnParsePublicationWriterLock,
} from './fn.publication';
import type {
  TPublicationEffects,
  TPublicationRecoveryIssue,
  TPublicationRecoveryJournalObservation,
  TPublicationRecoveryScan,
  TPublicationWriterLockObservation,
} from './typed';

type TEffects = Pick<TPublicationEffects, 'join' | 'lstat' | 'readdir' | 'readFile'>;

type TArgsReadLock = Readonly<{
  widgetRoot: string;
}>;

type TArgsScanRecovery = Readonly<{
  widgetRoot: string;
}>;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export async function readPublicationWriterLock(
  effects: TEffects,
  args: TArgsReadLock,
): Promise<TPublicationWriterLockObservation | null> {
  const path = effects.join(args.widgetRoot, '.writer.lock');
  let stat;
  try {
    stat = await effects.lstat(path);
  } catch (error) {
    if (fnIsMissingFilesystemError(error)) return null;
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8_192) {
    throw new Error('Widget writer lock is not a bounded direct file.');
  }
  const serialized = await effects.readFile(path, 'utf8');
  const record = fnParsePublicationWriterLock(serialized);
  if (record === null) throw new Error('Widget writer lock contents are invalid.');
  return Object.freeze({ path, serialized, record });
}

export async function scanPublicationRecoveryJournals(
  effects: TEffects,
  args: TArgsScanRecovery,
): Promise<TPublicationRecoveryScan> {
  const stagingPath = effects.join(args.widgetRoot, '.staging');
  let entries;
  try {
    entries = await effects.readdir(stagingPath, { withFileTypes: true });
  } catch (error) {
    if (fnIsMissingFilesystemError(error)) {
      return Object.freeze({ journals: Object.freeze([]), issues: Object.freeze([]) });
    }
    throw error;
  }
  const journals: TPublicationRecoveryJournalObservation[] = [];
  const issues: TPublicationRecoveryIssue[] = [];
  for (const entry of [...entries].sort((left, right) => compareText(left.name, right.name))) {
    if (!entry.name.endsWith('.replacement.json')) continue;
    const path = effects.join(stagingPath, entry.name);
    if (!entry.isFile() || entry.isSymbolicLink()) {
      issues.push(Object.freeze({ path, reason: 'Recovery journal is not a direct regular file.' }));
      continue;
    }
    const stat = await effects.lstat(path).catch(() => null);
    if (stat === null || !stat.isFile() || stat.isSymbolicLink() || stat.size > 16_384) {
      issues.push(Object.freeze({ path, reason: 'Recovery journal changed or is too large.' }));
      continue;
    }
    const serialized = await effects.readFile(path, 'utf8').catch(() => null);
    const journal = serialized === null ? null : fnParsePublicationJournal(serialized);
    if (serialized === null || journal === null) {
      issues.push(Object.freeze({ path, reason: 'Recovery journal contents are invalid.' }));
      continue;
    }
    if (entry.name !== `${journal.slug}.${journal.operationToken}.replacement.json`) {
      issues.push(Object.freeze({ path, reason: 'Recovery journal filename does not match its identity.' }));
      continue;
    }
    journals.push(Object.freeze({ path, serialized, journal }));
  }
  return Object.freeze({
    journals: Object.freeze(journals),
    issues: Object.freeze(issues),
  });
}
