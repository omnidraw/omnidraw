import {
  REPRODUCTION_TRACE_COPY_BUDGET_BYTES,
  REPRODUCTION_TRACE_DOWNLOAD_BUDGET_BYTES,
  REPRODUCTION_TRACE_MARK_TAIL_MS,
  REPRODUCTION_TRACE_MAX_EVENTS,
  REPRODUCTION_TRACE_SCHEMA_VERSION,
  REPRODUCTION_TRACE_SMART_CHANNELS,
} from './CONSTANTS';
import {
  fnBuildReproductionTraceArtifact,
  fnEstimateReproductionTraceBytes,
  fnPrepareReproductionTraceEvent,
  fnReproductionTraceEventIdentity,
  fnSanitizeReproductionTraceValue,
} from './fn.reproduction-trace';
import {
  txCopyReproductionTrace,
  txDownloadReproductionTrace,
} from './tx.reproduction-trace-export';
import type {
  TReproductionTraceArtifacts,
  TReproductionTraceChannel,
  TReproductionTraceEnvironment,
  TReproductionTraceEvent,
  TReproductionTraceEventInput,
  TReproductionTraceHeader,
  TReproductionTraceMode,
  TReproductionTraceOwner,
  TReproductionTraceState,
  TReproductionTraceStatus,
} from './typed';

type TCreateReproductionTraceOptions = Readonly<{
  environment(): TReproductionTraceEnvironment;
  monotonicNow(): number;
  wallClockNow(): Date;
  defer(callback: () => void): void;
  schedule(callback: () => void, delayMs: number): () => void;
  writeClipboard(text: string): Promise<void>;
  download(args: Readonly<{ filename: string; url: string }>): void;
  createObjectUrl(args: Readonly<{ mimeType: string; text: string }>): string;
  revokeObjectUrl(url: string): void;
}>;

function uniqueChannels(
  channels: readonly TReproductionTraceChannel[],
): readonly TReproductionTraceChannel[] {
  return Object.freeze([...new Set(channels)].sort());
}

export function createReproductionTrace(
  options: TCreateReproductionTraceOptions,
): TReproductionTraceOwner {
  let status: TReproductionTraceStatus = 'idle';
  let startedMonotonicMs = 0;
  let stoppedElapsedMs = 0;
  let sequence = 0;
  let markedSequence: number | null = null;
  let omittedEvents = 0;
  let redactedValues = 0;
  let estimatedBytes = 0;
  let header: TReproductionTraceHeader | null = null;
  let captureMode: TReproductionTraceMode = 'smart';
  let enabledChannels = uniqueChannels(REPRODUCTION_TRACE_SMART_CHANNELS);
  const events: TReproductionTraceEvent[] = [];
  const smartIdentityByBoundary = new Map<string, string>();
  const gestureByPointerId = new Map<string, string>();
  const gestureByTransactionId = new Map<string, string>();
  const gestureByCommandId = new Map<string, string>();
  let latestGestureId: string | null = null;
  let latestCommittedGestureId: string | null = null;
  let latestCommittedGestureGeneration = 0;
  let releaseMarkTail: (() => void) | null = null;
  const listeners = new Set<(state: TReproductionTraceState) => void>();
  const lifecycleListeners = new Set<(recording: boolean) => void>();

  const isRecording = (): boolean => status === 'recording' || status === 'marked';
  const elapsedMs = (): number => (
    isRecording()
      ? Math.max(0, options.monotonicNow() - startedMonotonicMs)
      : stoppedElapsedMs
  );
  const state = (): TReproductionTraceState => Object.freeze({
    status,
    elapsedMs: Math.round(elapsedMs()),
    retainedEvents: events.length,
    omittedEvents,
    estimatedBytes,
    markedSequence,
    enabledChannels,
    canStart: status === 'idle' && events.length === 0,
    canMark: status === 'recording',
    canStop: isRecording(),
    canExport: status === 'stopped' && events.length > 0,
    canClear: !isRecording(),
  });
  const notify = (): void => {
    const next = state();
    for (const listener of listeners) {
      try {
        listener(next);
      } catch {
        // Developer UI observers cannot alter recording.
      }
    }
  };
  const notifyLifecycle = (): void => {
    const recording = isRecording();
    for (const listener of lifecycleListeners) {
      try {
        listener(recording);
      } catch {
        // Instrumentation observers cannot alter recording.
      }
    }
  };
  const setBoundedCorrelation = (
    map: Map<string, string>,
    key: string,
    value: string,
  ): void => {
    if (!map.has(key) && map.size >= REPRODUCTION_TRACE_MAX_EVENTS) {
      const oldestKey = map.keys().next().value;
      if (oldestKey !== undefined) map.delete(oldestKey);
    }
    map.set(key, value);
  };
  const retireCorrelations = (
    input: TReproductionTraceEventInput,
    correlation: Readonly<{
      transactionId?: string;
      commandId?: string;
    }>,
  ): void => {
    if (
      input.channel !== 'document'
      || (
        input.type !== 'local-request-rejected'
        && input.type !== 'pending-retired'
        && input.type !== 'pending-invalidated'
      )
    ) return;
    if (correlation.transactionId !== undefined) {
      gestureByTransactionId.delete(correlation.transactionId);
    }
    if (correlation.commandId !== undefined) {
      gestureByCommandId.delete(correlation.commandId);
    }
  };
  const append = (rawInput: TReproductionTraceEventInput): void => {
    if (!isRecording() || !enabledChannels.includes(rawInput.channel)) return;
    const input = fnPrepareReproductionTraceEvent({
      event: rawInput,
      mode: captureMode,
    });
    if (input === null) return;
    const identity = fnReproductionTraceEventIdentity(input);
    if (captureMode === 'smart' && identity !== null) {
      const boundary = `${input.channel}:${input.type}`;
      if (smartIdentityByBoundary.get(boundary) === identity) return;
      smartIdentityByBoundary.set(boundary, identity);
    }
    sequence += 1;
    const correlation = { ...(input.correlation ?? {}) };
    if (
      correlation.gestureId === undefined
      && correlation.pointerId !== undefined
    ) {
      const pointerGestureId = gestureByPointerId.get(correlation.pointerId);
      if (pointerGestureId !== undefined) {
        correlation.gestureId = pointerGestureId;
      }
    }
    if (
      input.channel === 'transform'
      && correlation.pointerId !== undefined
      && correlation.gestureId !== undefined
    ) {
      const pointerGestureId = gestureByPointerId.get(correlation.pointerId);
      if (
        pointerGestureId !== undefined
        && pointerGestureId !== correlation.gestureId
      ) {
        correlation.engineGestureId = correlation.gestureId;
        correlation.gestureId = pointerGestureId;
      }
    }
    if (
      correlation.gestureId === undefined
      && correlation.transactionId !== undefined
    ) {
      const transactionGestureId = gestureByTransactionId.get(
        correlation.transactionId,
      );
      if (transactionGestureId !== undefined) {
        correlation.gestureId = transactionGestureId;
      }
    }
    if (
      correlation.gestureId === undefined
      && correlation.commandId !== undefined
    ) {
      const commandGestureId = gestureByCommandId.get(correlation.commandId);
      if (commandGestureId !== undefined) {
        correlation.gestureId = commandGestureId;
      }
    }
    if (
      correlation.gestureId === undefined
      && input.channel === 'document'
      && input.type === 'local-request'
      && latestCommittedGestureId !== null
    ) {
      correlation.gestureId = latestCommittedGestureId;
      latestCommittedGestureId = null;
    }
    if (
      correlation.pointerId !== undefined
      && correlation.gestureId !== undefined
    ) {
      setBoundedCorrelation(
        gestureByPointerId,
        correlation.pointerId,
        correlation.gestureId,
      );
    }
    if (
      correlation.transactionId !== undefined
      && correlation.gestureId !== undefined
    ) {
      setBoundedCorrelation(
        gestureByTransactionId,
        correlation.transactionId,
        correlation.gestureId,
      );
    }
    if (
      correlation.commandId !== undefined
      && correlation.gestureId !== undefined
    ) {
      setBoundedCorrelation(
        gestureByCommandId,
        correlation.commandId,
        correlation.gestureId,
      );
    }
    if (correlation.gestureId !== undefined) {
      latestGestureId = correlation.gestureId;
    }
    if (
      input.channel === 'transform'
      && input.type === 'transform-commit'
      && correlation.gestureId !== undefined
    ) {
      latestCommittedGestureId = correlation.gestureId;
      latestCommittedGestureGeneration += 1;
      const generation = latestCommittedGestureGeneration;
      options.defer(() => {
        if (latestCommittedGestureGeneration !== generation) return;
        latestCommittedGestureId = null;
      });
    }
    const sanitized = input.data === undefined
      ? null
      : fnSanitizeReproductionTraceValue(input.data);
    redactedValues += sanitized?.redacted ?? 0;
    const event: TReproductionTraceEvent = Object.freeze({
      sequence,
      elapsedMs: Math.round(elapsedMs() * 100) / 100,
      channel: input.channel,
      type: input.type,
      priority: input.priority ?? 'normal',
      ...(Object.keys(correlation).length === 0
        ? {}
        : { correlation: Object.freeze(correlation) }),
      ...(sanitized === null ? {} : { data: sanitized.value }),
    });
    events.push(event);
    if (
      input.channel === 'transform'
      && (
        input.type === 'transform-commit'
        || input.type === 'transform-cancel'
      )
      && correlation.pointerId !== undefined
    ) {
      gestureByPointerId.delete(correlation.pointerId);
    }
    retireCorrelations(input, correlation);
    estimatedBytes += fnEstimateReproductionTraceBytes(event);
    if (events.length > REPRODUCTION_TRACE_MAX_EVENTS) {
      const removable = events.findIndex((candidate) => (
        candidate.priority === 'low'
        && candidate.sequence !== markedSequence
      ));
      const removed = events.splice(removable < 0 ? 0 : removable, 1)[0];
      if (removed !== undefined) {
        omittedEvents += 1;
        estimatedBytes = Math.max(
          0,
          estimatedBytes - fnEstimateReproductionTraceBytes(removed),
        );
      }
    }
    notify();
  };
  const artifacts = (): TReproductionTraceArtifacts | null => {
    if (header === null || events.length === 0 || status !== 'stopped') return null;
    return Object.freeze({
      copy: fnBuildReproductionTraceArtifact({
        budgetBytes: REPRODUCTION_TRACE_COPY_BUDGET_BYTES,
        events,
        header,
        markedSequence,
        omittedBeforeExport: omittedEvents,
        redactedBeforeExport: redactedValues,
        status,
      }),
      download: fnBuildReproductionTraceArtifact({
        budgetBytes: REPRODUCTION_TRACE_DOWNLOAD_BUDGET_BYTES,
        events,
        header,
        markedSequence,
        omittedBeforeExport: omittedEvents,
        redactedBeforeExport: redactedValues,
        status,
      }),
    });
  };
  const stop = (): boolean => {
    if (!isRecording()) return false;
    releaseMarkTail?.();
    releaseMarkTail = null;
    append({
      channel: 'system',
      type: 'trace-stopped',
      priority: 'critical',
    });
    stoppedElapsedMs = elapsedMs();
    status = 'stopped';
    notifyLifecycle();
    notify();
    return true;
  };

  return Object.freeze({
    start(
      channels = REPRODUCTION_TRACE_SMART_CHANNELS,
      mode: TReproductionTraceMode = 'smart',
    ) {
      if (status !== 'idle' || events.length > 0) return false;
      captureMode = mode;
      enabledChannels = uniqueChannels(channels);
      smartIdentityByBoundary.clear();
      startedMonotonicMs = options.monotonicNow();
      stoppedElapsedMs = 0;
      status = 'recording';
      const environment = options.environment();
      header = Object.freeze({
        kind: 'omnidraw-developer-trace',
        schemaVersion: REPRODUCTION_TRACE_SCHEMA_VERSION,
        mode: captureMode,
        startedAt: options.wallClockNow().toISOString(),
        environment,
        enabledChannels,
        budgets: Object.freeze({
          copyBytes: REPRODUCTION_TRACE_COPY_BUDGET_BYTES,
          downloadBytes: REPRODUCTION_TRACE_DOWNLOAD_BUDGET_BYTES,
          maxEvents: REPRODUCTION_TRACE_MAX_EVENTS,
          markTailMs: REPRODUCTION_TRACE_MARK_TAIL_MS,
        }),
      });
      append({
        channel: 'system',
        type: 'trace-started',
        priority: 'critical',
        correlation: { canvasId: environment.canvasId },
      });
      notifyLifecycle();
      notify();
      return true;
    },
    mark() {
      if (status !== 'recording') return false;
      append({
        channel: 'system',
        type: 'failure-marked',
        priority: 'critical',
        correlation: latestGestureId === null
          ? undefined
          : { gestureId: latestGestureId },
      });
      markedSequence = sequence;
      status = 'marked';
      notify();
      releaseMarkTail = options.schedule(() => {
        releaseMarkTail = null;
        stop();
      }, REPRODUCTION_TRACE_MARK_TAIL_MS);
      return true;
    },
    stop,
    clear() {
      if (isRecording()) return;
      releaseMarkTail?.();
      releaseMarkTail = null;
      status = 'idle';
      startedMonotonicMs = 0;
      stoppedElapsedMs = 0;
      sequence = 0;
      markedSequence = null;
      omittedEvents = 0;
      redactedValues = 0;
      estimatedBytes = 0;
      header = null;
      events.length = 0;
      captureMode = 'smart';
      smartIdentityByBoundary.clear();
      gestureByPointerId.clear();
      gestureByTransactionId.clear();
      gestureByCommandId.clear();
      latestGestureId = null;
      latestCommittedGestureId = null;
      latestCommittedGestureGeneration += 1;
      notify();
    },
    emit: append,
    elapsedMs,
    isRecording,
    mode: () => captureMode,
    async copy() {
      const artifact = artifacts()?.copy;
      if (artifact === undefined) return false;
      await txCopyReproductionTrace(
        { writeText: options.writeClipboard },
        { text: artifact.text },
      );
      return true;
    },
    download() {
      const artifact = artifacts()?.download;
      if (artifact === undefined || header === null) return false;
      const date = header.startedAt.slice(0, 19).replace(/[:T]/g, '-');
      txDownloadReproductionTrace({
        createObjectUrl: options.createObjectUrl,
        revokeObjectUrl: options.revokeObjectUrl,
        clickDownload: options.download,
      }, {
        filename: `omnidraw-trace-${header.environment.canvasId}-${date}.jsonl`,
        text: artifact.text,
      });
      return true;
    },
    artifacts,
    state,
    subscribe(listener) {
      listeners.add(listener);
      listener(state());
      return () => listeners.delete(listener);
    },
    subscribeLifecycle(listener) {
      lifecycleListeners.add(listener);
      listener(isRecording());
      return () => lifecycleListeners.delete(listener);
    },
    dispose() {
      releaseMarkTail?.();
      releaseMarkTail = null;
      latestCommittedGestureGeneration += 1;
      latestCommittedGestureId = null;
      if (isRecording()) {
        stoppedElapsedMs = elapsedMs();
        status = 'stopped';
      }
      lifecycleListeners.clear();
      listeners.clear();
    },
  });
}
