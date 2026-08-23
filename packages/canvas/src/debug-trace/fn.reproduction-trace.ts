import type {
  TReproductionTraceAnomaly,
  TReproductionTraceArtifact,
  TReproductionTraceEvent,
  TReproductionTraceEventInput,
  TReproductionTraceHeader,
  TReproductionTraceMode,
  TReproductionTraceOmissions,
  TReproductionTraceStatus,
  TReproductionTraceSummary,
  TReproductionTraceValue,
} from './typed';
import {
  REPRODUCTION_TRACE_BINARY_PATTERN,
  REPRODUCTION_TRACE_PRIORITY_WEIGHT,
  REPRODUCTION_TRACE_SECRET_KEY_PATTERN,
  REPRODUCTION_TRACE_SECRET_VALUE_PATTERN,
} from './CONSTANTS';

type TSmartEventArgs = Readonly<{
  event: TReproductionTraceEventInput;
  mode: TReproductionTraceMode;
}>;

type TSanitizeResult = Readonly<{
  value: TReproductionTraceValue;
  redacted: number;
}>;

type TArtifactArgs = Readonly<{
  budgetBytes: number;
  events: readonly TReproductionTraceEvent[];
  header: TReproductionTraceHeader;
  markedSequence: number | null;
  omittedBeforeExport: number;
  redactedBeforeExport?: number;
  status: TReproductionTraceStatus;
}>;

const MAX_DEPTH = 5;
const MAX_KEYS = 32;
const MAX_ARRAY = 48;
const MAX_STRING = 512;
const TEXT_ENCODER_BYTES_PER_CODE_UNIT = 3;

function valueRecord(value: unknown): Readonly<Record<string, unknown>> {
  return (
    value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
  )
    ? value as Readonly<Record<string, unknown>>
    : {};
}

function activeModifiers(value: unknown): readonly string[] | undefined {
  const modifiers = valueRecord(value);
  const active = ['alt', 'control', 'meta', 'shift']
    .filter((key) => modifiers[key] === true);
  return active.length === 0 ? undefined : Object.freeze(active);
}

function pointTuple(value: unknown): readonly number[] | undefined {
  const point = valueRecord(value);
  return (
    typeof point.x === 'number'
    && typeof point.y === 'number'
  ) ? Object.freeze([point.x, point.y]) : undefined;
}

function definedRecord(
  entries: readonly (readonly [string, unknown])[],
): Readonly<Record<string, unknown>> {
  return Object.freeze(Object.fromEntries(
    entries.filter(([, value]) => value !== undefined),
  ));
}

function eventWithSmartData(
  event: TReproductionTraceEventInput,
  data: Readonly<Record<string, unknown>>,
): TReproductionTraceEventInput {
  return Object.freeze({
    ...event,
    data: Object.keys(data).length === 0 ? undefined : data,
  });
}

function smartInputData(
  event: TReproductionTraceEventInput,
): Readonly<Record<string, unknown>> {
  const data = valueRecord(event.data);
  if (event.type === 'key-down' || event.type === 'key-up') {
    return definedRecord([
      ['key', data.key],
      ['code', data.code],
      ['repeat', data.repeat === true ? true : undefined],
      ['mods', activeModifiers(data.modifiers)],
      ['target', data.target],
      ['prevented', data.defaultPrevented === true ? true : undefined],
    ]);
  }
  if (event.channel === 'input.dom') {
    return definedRecord([
      ['pointer', data.pointerType],
      ['button', data.button],
      ['buttons', data.buttons],
      ['at', pointTuple(data.client)],
      ['mods', activeModifiers(data.modifiers)],
      ['target', data.target],
      ['capture', data.captureOwner ?? undefined],
      ['prevented', data.defaultPrevented === true ? true : undefined],
    ]);
  }
  const hit = valueRecord(data.hit);
  return definedRecord([
    ['pointer', data.pointerType],
    ['button', data.button],
    ['buttons', data.buttons],
    ['world', pointTuple(data.world)],
    ['part', hit.part ?? undefined],
    ['mods', activeModifiers(data.modifiers)],
    ['cancel', data.cancelReason ?? undefined],
  ]);
}

function smartTransformData(
  event: TReproductionTraceEventInput,
): Readonly<Record<string, unknown>> {
  const data = valueRecord(event.data);
  return definedRecord([
    ['handle', data.handle],
    ['nodes', data.nodeIds],
    ['at', pointTuple(data.worldPointer)],
    ['mods', activeModifiers(data.modifiers)],
  ]);
}

function smartObservedData(
  event: TReproductionTraceEventInput,
): Readonly<Record<string, unknown>> {
  const data = valueRecord(event.data);
  if (event.channel === 'editor') {
    return definedRecord([
      ['status', data.status],
      ['tool', data.activeToolId],
      ['selected', data.selectedNodeIds],
      ['focused', data.focusedNodeId ?? undefined],
    ]);
  }
  return definedRecord([
    ['frame', data.frameNodeId ?? undefined],
    ['content', data.contentNodeId ?? undefined],
    ['maximized', data.maximizedNodeId ?? undefined],
    ['pressed', data.pressed ?? undefined],
  ]);
}

/**
 * Smart mode keeps causal boundaries and outcomes, not motion telemetry.
 * Advanced mode preserves the channel-selected technical input unchanged.
 */
export function fnPrepareReproductionTraceEvent(
  args: TSmartEventArgs,
): TReproductionTraceEventInput | null {
  if (args.mode === 'advanced') return args.event;
  const { event } = args;
  if (
    (
      (event.channel === 'input.dom' || event.channel === 'input.engine')
      && (
        event.type === 'pointer-move'
        || event.type === 'pointer-enter'
        || event.type === 'pointer-leave'
        || event.type === 'gesture-update'
        || event.type === 'wheel'
      )
    )
    || (event.channel === 'transform' && event.type === 'transform-update')
    || event.type === 'transform-hover-observed'
    || event.type === 'scene-publication-observed'
    || event.type === 'trace-started'
    || event.type === 'trace-stopped'
  ) return null;
  if (event.channel === 'picking' && event.type === 'hit-observed') {
    const data = valueRecord(event.data);
    const inputType = data.inputType;
    if (inputType !== 'pointer-down') return null;
    const hit = valueRecord(data.hit);
    return eventWithSmartData(
      event,
      definedRecord([
        ['part', hit.part ?? undefined],
        ['path', hit.path],
      ]),
    );
  }
  if (
    event.type === 'interaction-state-observed'
    && Object.keys(smartObservedData(event)).length === 0
  ) return null;
  if (event.channel === 'input.dom' || event.channel === 'input.engine') {
    return eventWithSmartData(event, smartInputData(event));
  }
  if (event.channel === 'transform') {
    return eventWithSmartData(event, smartTransformData(event));
  }
  if (
    event.type === 'state-observed'
    || event.type === 'interaction-state-observed'
  ) {
    return eventWithSmartData(event, smartObservedData(event));
  }
  return event;
}

export function fnReproductionTraceEventIdentity(
  event: TReproductionTraceEventInput,
): string | null {
  if (
    event.type !== 'state-observed'
    && event.type !== 'interaction-state-observed'
  ) return null;
  return `${event.channel}:${event.type}:${JSON.stringify(event.data ?? null)}`;
}

function jsonLine(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

function utf8Bytes(text: string): number {
  let bytes = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
      bytes += 4;
      index += 1;
    } else {
      bytes += TEXT_ENCODER_BYTES_PER_CODE_UNIT;
    }
  }
  return bytes;
}

function redaction(reason: string): TSanitizeResult {
  return {
    value: Object.freeze({ redacted: reason }),
    redacted: 1,
  };
}

function sanitize(
  value: unknown,
  key: string,
  depth: number,
  seen: ReadonlySet<object>,
): TSanitizeResult {
  if (REPRODUCTION_TRACE_SECRET_KEY_PATTERN.test(key)) {
    return redaction('secret-key');
  }
  if (value === null || typeof value === 'boolean') {
    return { value, redacted: 0 };
  }
  if (typeof value === 'number') {
    return {
      value: Number.isFinite(value) ? value : String(value),
      redacted: Number.isFinite(value) ? 0 : 1,
    };
  }
  if (typeof value === 'string') {
    if (REPRODUCTION_TRACE_SECRET_VALUE_PATTERN.test(value)) {
      return redaction('secret-pattern');
    }
    if (REPRODUCTION_TRACE_BINARY_PATTERN.test(value)) {
      return redaction('binary-or-data-url');
    }
    if (value.length <= MAX_STRING) return { value, redacted: 0 };
    return {
      value: `${value.slice(0, MAX_STRING)}…[${value.length - MAX_STRING} chars omitted]`,
      redacted: 1,
    };
  }
  if (
    value === undefined
    || typeof value === 'function'
    || typeof value === 'symbol'
    || typeof value === 'bigint'
  ) {
    return redaction(`unsupported-${typeof value}`);
  }
  if (depth >= MAX_DEPTH) return redaction('max-depth');
  if (typeof value !== 'object') return redaction('unsupported-value');
  if (seen.has(value)) return redaction('cyclic-reference');
  const nextSeen = new Set(seen);
  nextSeen.add(value);
  if (value instanceof Error) {
    const normalized = sanitize({
      name: value.name,
      message: value.message,
      stack: value.stack?.split('\n').slice(0, 8).join('\n') ?? '',
    }, key, depth + 1, nextSeen);
    return {
      value: Object.freeze({
        error: normalized.value,
        redacted: 'normalized-error',
      }),
      redacted: normalized.redacted + 1,
    };
  }
  if (Array.isArray(value)) {
    const values: TReproductionTraceValue[] = [];
    let redacted = value.length > MAX_ARRAY ? 1 : 0;
    for (const entry of value.slice(0, MAX_ARRAY)) {
      const result = sanitize(entry, key, depth + 1, nextSeen);
      values.push(result.value);
      redacted += result.redacted;
    }
    if (value.length > MAX_ARRAY) {
      values.push(Object.freeze({
        omitted: value.length - MAX_ARRAY,
        reason: 'max-array',
      }));
    }
    return { value: Object.freeze(values), redacted };
  }
  const entries = Object.entries(value as Readonly<Record<string, unknown>>)
    .sort(([left], [right]) => left.localeCompare(right));
  const result: Record<string, TReproductionTraceValue> = {};
  let redacted = entries.length > MAX_KEYS ? 1 : 0;
  for (const [entryKey, entryValue] of entries.slice(0, MAX_KEYS)) {
    const sanitized = sanitize(entryValue, entryKey, depth + 1, nextSeen);
    result[entryKey] = sanitized.value;
    redacted += sanitized.redacted;
  }
  if (entries.length > MAX_KEYS) {
    result.__omittedKeys = entries.length - MAX_KEYS;
  }
  return { value: Object.freeze(result), redacted };
}

export function fnSanitizeReproductionTraceValue(
  value: unknown,
): TSanitizeResult {
  return sanitize(value, '', 0, new Set());
}

const MOTION_DATA_KEYS = new Set([
  'centroidViewport',
  'centroidWorld',
  'client',
  'delta',
  'translation',
  'viewport',
  'world',
  'worldPointer',
]);

function stableDataKey(
  event: TReproductionTraceEvent,
): string {
  const data = event.data;
  if (data === undefined || data === null || typeof data !== 'object') {
    return JSON.stringify(data ?? null);
  }
  if (
    event.type.includes('observed')
    && !event.type.includes('hover')
  ) {
    return JSON.stringify(data);
  }
  if (Array.isArray(data)) return JSON.stringify(data);
  const semantic = Object.fromEntries(
    Object.entries(data)
      .filter(([key]) => !MOTION_DATA_KEYS.has(key)),
  );
  return JSON.stringify(semantic);
}

function coalesceKey(event: TReproductionTraceEvent): string | null {
  if (
    event.type.includes('move')
    || event.type.includes('preview')
    || event.type.includes('hover')
    || event.type.includes('camera')
    || event.type.includes('observed')
    || event.type.includes('update')
  ) {
    return [
      event.channel,
      event.type,
      event.correlation?.gestureId ?? '',
      event.correlation?.pointerId ?? '',
      event.correlation?.nodeId ?? '',
      stableDataKey(event),
    ].join(':');
  }
  return null;
}

type TMotionPoint = Readonly<{ x: number; y: number }>;

function motionPoint(
  event: TReproductionTraceEvent,
): TMotionPoint | null {
  if (
    event.data === undefined
    || event.data === null
    || typeof event.data !== 'object'
    || Array.isArray(event.data)
  ) return null;
  const data = event.data as Readonly<Record<string, TReproductionTraceValue>>;
  for (const key of [
    'client',
    'viewport',
    'worldPointer',
    'world',
    'centroidViewport',
    'centroidWorld',
  ]) {
    const candidate = data[key];
    const point = candidate as Readonly<Record<
      string,
      TReproductionTraceValue
    >> | null;
    if (
      point !== null
      && typeof point === 'object'
      && !Array.isArray(point)
      && typeof point.x === 'number'
      && typeof point.y === 'number'
    ) {
      return { x: point.x, y: point.y };
    }
  }
  return null;
}

function motionDescriptor(
  previous: TReproductionTraceEvent,
  current: TReproductionTraceEvent,
): string | null {
  const from = motionPoint(previous);
  const to = motionPoint(current);
  if (from === null || to === null) return null;
  const deltaX = to.x - from.x;
  const deltaY = to.y - from.y;
  const direction = `${Math.sign(deltaX)}:${Math.sign(deltaY)}`;
  const durationMs = Math.max(0.01, current.elapsedMs - previous.elapsedMs);
  const velocity = Math.hypot(deltaX, deltaY) / durationMs;
  const velocityBand = velocity < 0.1
    ? 'slow'
    : velocity < 0.8
      ? 'medium'
      : 'fast';
  return `${direction}:${velocityBand}`;
}

function meaningfulMotionIndexes(
  run: readonly TReproductionTraceEvent[],
): ReadonlySet<number> {
  const indexes = new Set<number>([0, run.length - 1]);
  let previousDescriptor: string | null = null;
  for (let index = 1; index < run.length; index += 1) {
    const descriptor = motionDescriptor(run[index - 1]!, run[index]!);
    if (
      descriptor !== null
      && previousDescriptor !== null
      && descriptor !== previousDescriptor
    ) {
      indexes.add(index - 1);
      indexes.add(index);
    }
    if (descriptor !== null) previousDescriptor = descriptor;
  }
  return indexes;
}

function motionExtrema(
  run: readonly TReproductionTraceEvent[],
): TReproductionTraceValue {
  const points = run
    .map(motionPoint)
    .filter((point): point is TMotionPoint => point !== null);
  if (points.length === 0) return null;
  return Object.freeze({
    minX: Math.min(...points.map((point) => point.x)),
    maxX: Math.max(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxY: Math.max(...points.map((point) => point.y)),
  });
}

export function fnCompactReproductionTraceEvents(
  events: readonly TReproductionTraceEvent[],
): Readonly<{
  events: readonly TReproductionTraceEvent[];
  coalesced: number;
  summarized: number;
}> {
  const retained: TReproductionTraceEvent[] = [];
  let coalesced = 0;
  let summarized = 0;
  for (let index = 0; index < events.length;) {
    const first = events[index]!;
    const key = coalesceKey(first);
    if (key === null) {
      retained.push(first);
      index += 1;
      continue;
    }
    let end = index + 1;
    while (end < events.length && coalesceKey(events[end]!) === key) end += 1;
    const run = events.slice(index, end);
    const retainedIndexes = meaningfulMotionIndexes(run);
    const omittedIndexes = run
      .map((_, runIndex) => runIndex)
      .filter((runIndex) => !retainedIndexes.has(runIndex));
    for (const runIndex of retainedIndexes) retained.push(run[runIndex]!);
    if (omittedIndexes.length > 0) {
      const omitted = omittedIndexes.length;
      coalesced += omitted;
      summarized += 1;
      const summarySequence = run[omittedIndexes.at(-1)!]!.sequence;
      retained.push(Object.freeze({
        sequence: summarySequence,
        elapsedMs: run.at(-1)!.elapsedMs,
        channel: first.channel,
        type: 'samples-coalesced',
        priority: 'high',
        ...(first.correlation === undefined
          ? {}
          : { correlation: first.correlation }),
        data: Object.freeze({
          sourceType: first.type,
          count: omitted,
          firstSequence: first.sequence,
          lastSequence: run.at(-1)!.sequence,
          startElapsedMs: first.elapsedMs,
          endElapsedMs: run.at(-1)!.elapsedMs,
          extrema: motionExtrema(run),
        }),
      }));
    }
    index = end;
  }
  return {
    events: Object.freeze(retained.sort(
      (left, right) => left.sequence - right.sequence,
    )),
    coalesced,
    summarized,
  };
}

function anomalyCandidates(
  events: readonly TReproductionTraceEvent[],
): readonly TReproductionTraceAnomaly[] {
  const anomalies: TReproductionTraceAnomaly[] = [];
  const byGesture = new Map<string, TReproductionTraceEvent[]>();
  const byTransaction = new Map<string, TReproductionTraceEvent[]>();
  const byCommand = new Map<string, TReproductionTraceEvent[]>();
  for (const event of events) {
    const gestureId = event.correlation?.gestureId;
    if (gestureId !== undefined) {
      const chain = byGesture.get(gestureId) ?? [];
      chain.push(event);
      byGesture.set(gestureId, chain);
    }
    const transactionId = event.correlation?.transactionId;
    if (transactionId !== undefined) {
      const chain = byTransaction.get(transactionId) ?? [];
      chain.push(event);
      byTransaction.set(transactionId, chain);
    }
    const commandId = event.correlation?.commandId;
    if (commandId !== undefined) {
      const chain = byCommand.get(commandId) ?? [];
      chain.push(event);
      byCommand.set(commandId, chain);
    }
  }
  for (const [gestureId, chain] of byGesture) {
    const began = chain.find((event) => event.type === 'transform-begin');
    const terminal = chain.find((event) => (
      event.type === 'transform-commit' || event.type === 'transform-cancel'
    ));
    if (began !== undefined && terminal === undefined) {
      anomalies.push(Object.freeze({
        kind: 'possible anomaly',
        rule: 'transform-without-terminal',
        relatedSequences: Object.freeze(chain.map((event) => event.sequence)),
        explanation: `Gesture ${gestureId} began a transform without a commit or cancel event.`,
      }));
    }
    const committed = chain.find((event) => event.type === 'transform-commit');
    const mutation = chain.find((event) => event.type === 'local-request');
    if (committed !== undefined && mutation === undefined) {
      anomalies.push(Object.freeze({
        kind: 'possible anomaly',
        rule: 'transform-commit-without-editor-mutation',
        relatedSequences: Object.freeze([committed.sequence]),
        explanation: `Gesture ${gestureId} committed without a correlated editor mutation.`,
      }));
    }
  }
  const mark = events.find((event) => event.type === 'failure-marked');
  if (mark !== undefined) {
    const markedGestureId = mark.correlation?.gestureId
      ?? [...byGesture]
        .filter(([, chain]) => chain[0]!.sequence < mark.sequence)
        .sort(([, left], [, right]) => (
          right.at(-1)!.sequence - left.at(-1)!.sequence
        ))[0]?.[0];
    const markedChain = markedGestureId === undefined
      ? undefined
      : byGesture.get(markedGestureId);
    if (
      markedChain !== undefined
      && markedChain.some((event) => event.type === 'pointer-down')
      && !markedChain.some((event) => (
        event.type === 'transform-begin'
        || event.type === 'transform-commit'
        || event.type === 'transform-cancel'
      ))
    ) {
      anomalies.push(Object.freeze({
        kind: 'possible anomaly',
        rule: 'marked-gesture-without-transform',
        relatedSequences: Object.freeze([...new Set([
          ...markedChain.map((event) => event.sequence),
          mark.sequence,
        ])].sort((left, right) => left - right)),
        explanation: `Marked gesture ${markedGestureId} ended without a transform boundary.`,
      }));
    }
  }
  for (const [transactionId, chain] of byTransaction) {
    const projected = chain.find((event) => event.type === 'projection-applied');
    const dispatched = chain.find((event) => event.type === 'command-dispatched');
    const rejected = chain.find((event) => event.type === 'local-request-rejected');
    if (rejected !== undefined && projected === undefined) {
      anomalies.push(Object.freeze({
        kind: 'possible anomaly',
        rule: 'mutation-rejected-before-projection',
        relatedSequences: Object.freeze([rejected.sequence]),
        explanation: `Transaction ${transactionId} was rejected before projection.`,
      }));
    } else if (projected !== undefined && dispatched === undefined) {
      anomalies.push(Object.freeze({
        kind: 'possible anomaly',
        rule: 'projection-without-command-dispatch',
        relatedSequences: Object.freeze([projected.sequence]),
        explanation: `Transaction ${transactionId} projected without a command dispatch.`,
      }));
    }
  }
  for (const [commandId, chain] of byCommand) {
    const failure = chain.find((event) => (
      event.type === 'execute-failed'
      || event.type === 'acknowledgement-rejected'
      || event.type === 'revision-gap'
    ));
    if (failure !== undefined) {
      anomalies.push(Object.freeze({
        kind: 'possible anomaly',
        rule: 'command-failure',
        relatedSequences: Object.freeze(chain.map((event) => event.sequence)),
        explanation: `Command ${commandId} encountered ${failure.type}.`,
      }));
    }
  }
  const lastPointerById = new Map<string, TReproductionTraceEvent>();
  for (const event of events) {
    if (event.channel !== 'input.dom') continue;
    const pointerId = event.correlation?.pointerId;
    if (pointerId !== undefined) lastPointerById.set(pointerId, event);
  }
  for (const [pointerId, event] of lastPointerById) {
    if (event.type !== 'pointer-down' && event.type !== 'capture-gained') continue;
    anomalies.push(Object.freeze({
      kind: 'possible anomaly',
      rule: 'pointer-ownership-not-terminated',
      relatedSequences: Object.freeze([event.sequence]),
      explanation: `Pointer ${pointerId} ended with ${event.type} as its last recorded boundary.`,
    }));
  }
  return Object.freeze(anomalies);
}

function traceSummary(
  args: Readonly<{
    events: readonly TReproductionTraceEvent[];
    status: TReproductionTraceStatus;
    markedSequence: number | null;
    omissions: TReproductionTraceOmissions;
  }>,
): TReproductionTraceSummary {
  const eventCounts: Record<string, number> = {};
  const gestures = new Map<string, TReproductionTraceEvent[]>();
  for (const event of args.events) {
    const key = `${event.channel}:${event.type}`;
    eventCounts[key] = (eventCounts[key] ?? 0) + 1;
    const gestureId = event.correlation?.gestureId;
    if (gestureId === undefined) continue;
    const chain = gestures.get(gestureId) ?? [];
    chain.push(event);
    gestures.set(gestureId, chain);
  }
  return Object.freeze({
    kind: 'summary',
    status: args.status,
    durationMs: args.events.at(-1)?.elapsedMs ?? 0,
    markedSequence: args.markedSequence,
    eventCounts: Object.freeze(eventCounts),
    gestureChains: Object.freeze([...gestures].map(([gestureId, chain]) => (
      Object.freeze({
        gestureId,
        sequences: Object.freeze(chain.map((event) => event.sequence)),
        channels: Object.freeze([...new Set(chain.map((event) => event.channel))]),
      })
    ))),
    anomalies: anomalyCandidates(args.events),
    omissions: args.omissions,
  });
}

function eventProtected(
  event: TReproductionTraceEvent,
  markedSequence: number | null,
): boolean {
  return (
    event.priority === 'critical'
    || event.sequence === markedSequence
    || event.type.includes('error')
    || event.type.includes('failed')
    || event.type.includes('recovery')
    || event.type.includes('rejected')
    || event.type.includes('commit')
    || event.type.includes('cancel')
    || event.type.includes('dispatch')
    || event.type.includes('acknowledgement')
    || event.type === 'pointer-down'
    || event.type === 'pointer-up'
    || event.type === 'pointer-cancel'
  );
}

function artifactBody(
  header: TReproductionTraceHeader,
  summary: TReproductionTraceSummary,
  events: readonly TReproductionTraceEvent[],
  markdown: boolean,
): string {
  const jsonl = [
    jsonLine(header).trimEnd(),
    jsonLine(summary).trimEnd(),
    ...events.map((event) => jsonLine(event).trimEnd()),
  ].join('\n');
  if (!markdown) return `${jsonl}\n`;
  const record = (
    event: TReproductionTraceEvent | undefined,
  ): Readonly<Record<string, TReproductionTraceValue>> => (
    event?.data !== null
    && event?.data !== undefined
    && typeof event.data === 'object'
    && !Array.isArray(event.data)
  ) ? event.data as Readonly<Record<string, TReproductionTraceValue>> : {};
  const aliases = (
    values: readonly string[],
    prefix: string,
  ): ReadonlyMap<string, string> => new Map(
    [...new Set(values)].map((value, index) => [value, `${prefix}${index + 1}`]),
  );
  const nodeAliases = aliases(events.flatMap((event) => {
    const nodes = record(event).nodes;
    return [
      ...(event.correlation?.nodeId === undefined
        ? []
        : [event.correlation.nodeId]),
      ...(Array.isArray(nodes)
        ? nodes.filter((value): value is string => typeof value === 'string')
        : []),
    ];
  }), 'n');
  const gestureAliases = aliases(events.flatMap((event) => (
    event.correlation?.gestureId === undefined
      ? []
      : [event.correlation.gestureId]
  )), 'g');
  const widgetAliases = aliases(events.flatMap((event) => (
    event.correlation?.widgetId === undefined
      ? []
      : [event.correlation.widgetId]
  )), 'w');
  const transactionAliases = aliases(events.flatMap((event) => (
    event.correlation?.transactionId === undefined
      ? []
      : [event.correlation.transactionId]
  )), 'tx');
  const commandAliases = aliases(events.flatMap((event) => (
    event.correlation?.commandId === undefined
      ? []
      : [event.correlation.commandId]
  )), 'cmd');
  const commandGesture = new Map<string, string>();
  const transactionGesture = new Map<string, string>();
  for (const event of events) {
    const gestureId = event.correlation?.gestureId;
    if (gestureId === undefined) continue;
    const commandId = event.correlation?.commandId;
    const transactionId = event.correlation?.transactionId;
    if (commandId !== undefined) commandGesture.set(commandId, gestureId);
    if (transactionId !== undefined) {
      transactionGesture.set(transactionId, gestureId);
    }
  }
  const gestureGroups = new Map<string, TReproductionTraceEvent[]>();
  const ungrouped: TReproductionTraceEvent[] = [];
  for (const event of events) {
    const gestureId = event.correlation?.gestureId
      ?? (
        event.correlation?.commandId === undefined
          ? undefined
          : commandGesture.get(event.correlation.commandId)
      )
      ?? (
        event.correlation?.transactionId === undefined
          ? undefined
          : transactionGesture.get(event.correlation.transactionId)
      );
    if (gestureId === undefined) {
      ungrouped.push(event);
      continue;
    }
    const group = gestureGroups.get(gestureId) ?? [];
    group.push(event);
    gestureGroups.set(gestureId, group);
  }
  for (const event of [...ungrouped]) {
    if (
      event.type !== 'state-observed'
      && event.type !== 'interaction-state-observed'
    ) continue;
    const group = [...gestureGroups.values()].find((candidate) => (
      event.sequence >= candidate[0]!.sequence
      && event.sequence <= candidate.at(-1)!.sequence
    ));
    if (group === undefined) continue;
    group.push(event);
    group.sort((left, right) => left.sequence - right.sequence);
    ungrouped.splice(ungrouped.indexOf(event), 1);
  }
  const markedGestures = new Set<string>();
  if (summary.markedSequence !== null) {
    const explicit = events.find(
      (event) => event.sequence === summary.markedSequence,
    )?.correlation?.gestureId;
    if (explicit !== undefined) {
      markedGestures.add(explicit);
    } else {
      const preceding = [...gestureGroups]
        .filter(([, group]) => (
          group[0]!.sequence < summary.markedSequence!
        ))
        .sort(([, left], [, right]) => (
          right.at(-1)!.sequence - left.at(-1)!.sequence
        ))[0];
      if (preceding !== undefined) markedGestures.add(preceding[0]);
    }
  }
  const rounded = (value: number): number => Math.round(value * 10) / 10;
  const point = (
    event: TReproductionTraceEvent | undefined,
  ): string | null => {
    const candidate = record(event).at;
    if (
      !Array.isArray(candidate)
      || typeof candidate[0] !== 'number'
      || typeof candidate[1] !== 'number'
    ) return null;
    return `[${rounded(candidate[0])},${rounded(candidate[1])}]`;
  };
  const eventOf = (
    group: readonly TReproductionTraceEvent[],
    type: string,
  ): TReproductionTraceEvent | undefined => (
    group.find((event) => event.type === type)
  );
  const has = (
    group: readonly TReproductionTraceEvent[],
    type: string,
  ): boolean => eventOf(group, type) !== undefined;
  const revision = (
    event: TReproductionTraceEvent | undefined,
    key: string,
  ): number | null => {
    const value = record(event)[key];
    return typeof value === 'number' ? value : null;
  };
  const gestureEntries = [...gestureGroups].map(([gestureId, group]) => {
    const domDown = eventOf(group, 'pointer-down');
    const engineDown = group.find((event) => (
      event.channel === 'input.engine'
      && event.type === 'pointer-down'
    ));
    const pointerUp = eventOf(group, 'pointer-up');
    const transformBegin = eventOf(group, 'transform-begin');
    const transformCommit = eventOf(group, 'transform-commit');
    const transformCancel = eventOf(group, 'transform-cancel');
    const localRequest = eventOf(group, 'local-request');
    const projected = eventOf(group, 'projection-applied');
    const dispatched = eventOf(group, 'command-dispatched');
    const received = eventOf(group, 'execute-received');
    const acknowledged = eventOf(group, 'acknowledgement-accepted');
    const persistenceFailure = group.find((event) => (
      event.type === 'execute-failed'
      || event.type === 'acknowledgement-rejected'
      || event.type === 'local-request-rejected'
    ));
    const transform = transformBegin ?? transformCommit ?? transformCancel;
    const handle = record(transform).handle;
    const action = transform !== undefined
      ? (handle === 'move' ? 'drag' : `transform:${String(handle ?? 'unknown')}`)
      : domDown !== undefined && pointerUp !== undefined
        ? 'click'
        : 'pointer';
    const correlatedNodeId = group
      .map((event) => event.correlation?.nodeId)
      .find((value): value is string => value !== undefined);
    const transformedNodeIds = Array.isArray(record(transform).nodes)
      ? (record(transform).nodes as readonly TReproductionTraceValue[])
        .filter((value): value is string => typeof value === 'string')
      : [];
    const targetNodeIds = correlatedNodeId === undefined
      ? transformedNodeIds
      : [correlatedNodeId];
    const target = targetNodeIds.length === 0
      ? 'empty'
      : targetNodeIds.map((nodeId) => (
          nodeAliases.get(nodeId) ?? 'node?'
        )).join(',');
    const start = point(transformBegin) ?? point(domDown);
    const end = point(transformCommit ?? transformCancel) ?? point(pointerUp);
    const parts = [
      `${gestureAliases.get(gestureId) ?? 'g?'}@${rounded(group[0]!.elapsedMs)}-${rounded(group.at(-1)!.elapsedMs)}`,
      `#${group[0]!.sequence}-${group.at(-1)!.sequence}`,
      markedGestures.has(gestureId) ? '[MARK]' : '',
      action,
      target,
      start === null || end === null ? '' : `${start}→${end}`,
      domDown !== undefined && engineDown !== undefined
        ? 'input=dom>engine'
        : domDown !== undefined
          ? 'input=dom-only'
          : engineDown !== undefined
            ? 'input=engine-only'
            : '',
    ];
    if (transformCommit !== undefined) parts.push('transform=commit');
    else if (transformCancel !== undefined) parts.push('transform=cancel');
    else if (transformBegin !== undefined) parts.push('transform=open');
    else if (markedGestures.has(gestureId)) parts.push('transform=none');
    if (persistenceFailure !== undefined) {
      parts.push(`persist=failed:${persistenceFailure.type}`);
    } else if (acknowledged !== undefined || received !== undefined) {
      const before = revision(localRequest, 'accepted');
      const after = revision(acknowledged, 'accepted')
        ?? revision(received, 'revision');
      const duration = revision(received, 'durationMs');
      parts.push([
        'persist=ok',
        before === null || after === null ? '' : `r${before}→${after}`,
        duration === null ? '' : `${rounded(duration)}ms`,
      ].filter((part) => part.length > 0).join(' '));
    } else if (dispatched !== undefined) {
      parts.push('persist=pending');
    } else if (projected !== undefined) {
      parts.push('dispatch=missing');
    } else if (localRequest !== undefined) {
      parts.push('projection=missing');
    } else if (transformCommit !== undefined) {
      parts.push('document=missing');
    }
    const editorState = [...group].reverse().find(
      (event) => event.type === 'state-observed',
    );
    const selected = record(editorState).selected;
    if (Array.isArray(selected)) {
      parts.push(selected.length === 0
        ? 'selection=none'
        : `selection=${selected.map((value) => (
            typeof value === 'string'
              ? nodeAliases.get(value) ?? 'node?'
              : '?'
          )).join(',')}`);
    }
    return {
      sequence: group[0]!.sequence,
      line: parts.filter((part) => part.length > 0).join(' '),
    };
  });
  const ids = (
    correlation: TReproductionTraceEvent['correlation'],
  ): string => {
    if (correlation === undefined) return '';
    return [
      correlation.nodeId === undefined
        ? ''
        : `node=${nodeAliases.get(correlation.nodeId) ?? 'node?'}`,
      correlation.widgetId === undefined
        ? ''
        : `widget=${widgetAliases.get(correlation.widgetId) ?? 'w?'}`,
      correlation.transactionId === undefined
        ? ''
        : `tx=${transactionAliases.get(correlation.transactionId) ?? 'tx?'}`,
      correlation.commandId === undefined
        ? ''
        : `cmd=${commandAliases.get(correlation.commandId) ?? 'cmd?'}`,
    ].filter((part) => part.length > 0).join(' ');
  };
  const ungroupedData = (event: TReproductionTraceEvent): string => {
    if (event.data === undefined) return '';
    if (
      event.data === null
      || typeof event.data !== 'object'
      || Array.isArray(event.data)
    ) return JSON.stringify(event.data);
    const compact = Object.fromEntries(
      Object.entries(event.data).filter(([, value]) => (
        value !== null
        && !(Array.isArray(value) && value.length === 0)
      )),
    );
    return Object.keys(compact).length === 0 ? '' : JSON.stringify(compact);
  };
  const eventEntries = ungrouped
    .filter((event) => (
      !(event.type === 'failure-marked' && markedGestures.size > 0)
      && event.type !== 'capture-gained'
      && event.type !== 'capture-lost'
      && event.type !== 'state-observed'
      && event.type !== 'interaction-state-observed'
    ))
    .map((event) => ({
      sequence: event.sequence,
      line: event.type === 'failure-marked'
        ? `${event.sequence}@${rounded(event.elapsedMs)} [MARK]`
        : [
            `${event.sequence}@${rounded(event.elapsedMs)}`,
            `${event.channel}/${event.type}`,
            ids(event.correlation),
            ungroupedData(event),
          ].filter((part) => part.length > 0).join(' '),
    }));
  const timelineLines = [...gestureEntries, ...eventEntries]
    .sort((left, right) => left.sequence - right.sequence)
    .map((entry) => entry.line);
  const anomalyLine = summary.anomalies.length === 0
    ? 'none'
    : summary.anomalies.map((entry) => (
        `${entry.rule}[${entry.relatedSequences.join(',')}]`
      )).join(' ');
  return [
    'Omnidraw developer trace: host-owned causal boundaries, not replay.',
    `meta canvas=${header.environment.canvasId} mode=${header.mode} build=${header.environment.buildMode} app=${header.environment.applicationVersion} engine=${header.environment.cangineVersion} viewport=${header.environment.viewport.width}x${header.environment.viewport.height}@${header.environment.devicePixelRatio}`,
    `capture duration=${summary.durationMs}ms facts=${summary.omissions.retained}/${summary.omissions.captured} rows=${timelineLines.length} coalesced=${summary.omissions.coalesced} omitted=${summary.omissions.omitted} redacted=${summary.omissions.redacted} mark=${summary.markedSequence ?? 'none'}`,
    `anomalies ${anomalyLine}`,
    '',
    '```text',
    'gesture@ms seq mark action target path boundaries outcome',
    ...timelineLines,
    '```',
    '',
  ].join('\n');
}

export function fnBuildReproductionTraceArtifact(
  args: TArtifactArgs,
): TReproductionTraceArtifact {
  const compacted = fnCompactReproductionTraceEvents(args.events);
  const sanitized: TReproductionTraceEvent[] = [];
  let redacted = args.redactedBeforeExport ?? 0;
  for (const event of compacted.events) {
    if (event.data === undefined) {
      sanitized.push(event);
      continue;
    }
    const result = fnSanitizeReproductionTraceValue(event.data);
    redacted += result.redacted;
    sanitized.push(Object.freeze({ ...event, data: result.value }));
  }
  const retained = [...sanitized];
  let budgetOmitted = 0;
  const markdown = args.budgetBytes <= 128 * 1024;
  const build = (): Readonly<{
    text: string;
    summary: TReproductionTraceSummary;
  }> => {
    const omissions: TReproductionTraceOmissions = Object.freeze({
      captured: args.events.length + args.omittedBeforeExport,
      retained: retained.length,
      coalesced: compacted.coalesced,
      summarized: compacted.summarized,
      omitted: args.omittedBeforeExport + budgetOmitted,
      redacted,
    });
    const summary = traceSummary({
      events: retained,
      status: args.status,
      markedSequence: args.markedSequence,
      omissions,
    });
    return {
      text: artifactBody(args.header, summary, retained, markdown),
      summary,
    };
  };
  let built = build();
  while (utf8Bytes(built.text) > args.budgetBytes) {
    const currentBytes = utf8Bytes(built.text);
    const removeCount = Math.max(
      1,
      Math.ceil(
        retained.length
        * Math.min(0.25, (currentBytes - args.budgetBytes) / currentBytes),
      ),
    );
    const candidates = retained
      .map((event, index) => ({ event, index }))
      .filter(({ event }) => !eventProtected(event, args.markedSequence))
      .sort((left, right) => (
        REPRODUCTION_TRACE_PRIORITY_WEIGHT[left.event.priority]
        - REPRODUCTION_TRACE_PRIORITY_WEIGHT[right.event.priority]
        || left.event.sequence - right.event.sequence
      ))
      .slice(0, removeCount);
    const fallback = candidates.length > 0
      ? candidates
      : retained
        .map((event, index) => ({ event, index }))
        .filter(({ event }) => event.sequence !== args.markedSequence)
        .slice(0, removeCount);
    if (fallback.length === 0) break;
    const removeIndexes = new Set(fallback.map(({ index }) => index));
    const next = retained.filter((_, index) => !removeIndexes.has(index));
    budgetOmitted += retained.length - next.length;
    retained.splice(0, retained.length, ...next);
    built = build();
  }
  return Object.freeze({
    text: built.text,
    bytes: utf8Bytes(built.text),
    summary: built.summary,
  });
}

export function fnEstimateReproductionTraceBytes(
  event: TReproductionTraceEvent,
): number {
  const estimate = (value: unknown, depth: number): number => {
    if (depth > MAX_DEPTH || value === null || value === undefined) return 4;
    if (typeof value === 'boolean' || typeof value === 'number') return 8;
    if (typeof value === 'string') return Math.min(value.length, MAX_STRING) * 2;
    if (Array.isArray(value)) {
      return value.slice(0, MAX_ARRAY).reduce(
        (sum, entry) => sum + estimate(entry, depth + 1),
        2,
      );
    }
    if (typeof value === 'object') {
      return Object.entries(value).slice(0, MAX_KEYS).reduce(
        (sum, [key, entry]) => sum + key.length + estimate(entry, depth + 1),
        2,
      );
    }
    return 16;
  };
  return 96 + estimate(event.data, 0);
}
