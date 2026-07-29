import {
  PREVIEW_LOG_MAX_ENTRIES,
  PREVIEW_LOG_MAX_MESSAGE_LENGTH,
} from './CONSTANTS';

export type TPreviewLogLevel = 'info' | 'success' | 'warning' | 'error';

export type TPreviewLogSource =
  | 'lifecycle'
  | 'build'
  | 'revision'
  | 'diagnostic';

export type TPreviewLogSelection = Readonly<{
  revision: string;
  bindingRevision: number;
}>;

export type TPreviewLogEvent =
  | Readonly<{
      kind: 'lifecycle';
      level: TPreviewLogLevel;
      message: string;
    }>
  | Readonly<{
      kind: 'build';
      phase:
        | 'queued'
        | 'installing'
        | 'building'
        | 'validating'
        | 'ready'
        | 'failed'
        | 'superseded'
        | 'cancelled';
      revision: string;
      buildSequence: number;
      displayed: TPreviewLogSelection | null;
    }>
  | Readonly<{
      kind: 'revision';
      selection: TPreviewLogSelection;
    }>
  | Readonly<{
      kind: 'diagnostic';
      code: string;
      message: string;
      occurrenceCount: number;
    }>;

export type TPreviewLogEntry = Readonly<{
  sequence: number;
  source: TPreviewLogSource;
  level: TPreviewLogLevel;
  message: string;
  buildSequence: number | null;
  truncated: boolean;
}>;

type TArgsProject = Readonly<{
  sequence: number;
  event: TPreviewLogEvent;
  maxMessageLength?: number;
}>;

type TArgsRetain = Readonly<{
  entries: readonly TPreviewLogEntry[];
  entry: TPreviewLogEntry;
  maxEntries?: number;
}>;

function shortRevision(revision: string): string {
  return revision.slice(0, 8);
}

function displayedSuffix(selection: TPreviewLogSelection | null): string {
  return selection === null
    ? ''
    : ` Showing ${shortRevision(selection.revision)} • bindings #${
      selection.bindingRevision
    }`;
}

function buildMessage(
  event: Extract<TPreviewLogEvent, { kind: 'build' }>,
): string {
  const revision = shortRevision(event.revision);
  const message = event.phase === 'queued'
    ? `Queued ${revision}…`
    : event.phase === 'installing'
      ? `Installing ${revision}…`
      : event.phase === 'building'
        ? `Building ${revision}…`
        : event.phase === 'validating'
          ? `Validating ${revision}…`
          : event.phase === 'ready'
            ? `Verifying ${revision}…`
            : event.phase === 'failed'
              ? `Build ${revision} failed.`
              : event.phase === 'superseded'
                ? `Build ${revision} superseded…`
                : `Build ${revision} cancelled.`;
  return `${message}${displayedSuffix(event.displayed)}`;
}

function eventMessage(event: TPreviewLogEvent): string {
  if (event.kind === 'lifecycle') return event.message;
  if (event.kind === 'build') return buildMessage(event);
  if (event.kind === 'revision') {
    return `Showing ${shortRevision(event.selection.revision)} • bindings #${
      event.selection.bindingRevision
    }`;
  }
  return `${event.code}: ${event.message} • occurrence ${
    event.occurrenceCount
  }`;
}

function eventLevel(event: TPreviewLogEvent): TPreviewLogLevel {
  if (event.kind === 'lifecycle') return event.level;
  if (event.kind === 'diagnostic' || (
    event.kind === 'build' && event.phase === 'failed'
  )) return 'error';
  if (event.kind === 'revision') return 'success';
  if (
    event.kind === 'build'
    && (event.phase === 'superseded' || event.phase === 'cancelled')
  ) return 'warning';
  return 'info';
}

function eventSource(event: TPreviewLogEvent): TPreviewLogSource {
  return event.kind;
}

function boundedMessage(
  value: string,
  maxMessageLength: number,
): Readonly<{ message: string; truncated: boolean }> {
  const normalized = value
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim();
  if (normalized.length <= maxMessageLength) {
    return { message: normalized, truncated: false };
  }
  return {
    message: `${normalized.slice(0, Math.max(0, maxMessageLength - 1))}…`,
    truncated: true,
  };
}

export function fnProjectPreviewLogEntry(
  args: TArgsProject,
): TPreviewLogEntry {
  const maxMessageLength = Math.max(
    1,
    Math.min(2_048, args.maxMessageLength ?? PREVIEW_LOG_MAX_MESSAGE_LENGTH),
  );
  const bounded = boundedMessage(eventMessage(args.event), maxMessageLength);
  return Object.freeze({
    sequence: args.sequence,
    source: eventSource(args.event),
    level: eventLevel(args.event),
    message: bounded.message,
    buildSequence: args.event.kind === 'build'
      ? args.event.buildSequence
      : null,
    truncated: bounded.truncated,
  });
}

export function fnRetainPreviewLogEntries(
  args: TArgsRetain,
): readonly TPreviewLogEntry[] {
  const maxEntries = Math.max(
    1,
    Math.min(200, args.maxEntries ?? PREVIEW_LOG_MAX_ENTRIES),
  );
  const bySequence = new Map<number, TPreviewLogEntry>();
  for (const entry of args.entries) bySequence.set(entry.sequence, entry);
  bySequence.set(args.entry.sequence, args.entry);
  return Object.freeze(
    [...bySequence.values()]
      .sort((left, right) => left.sequence - right.sequence)
      .slice(-maxEntries),
  );
}
