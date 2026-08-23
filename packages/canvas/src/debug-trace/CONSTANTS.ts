import type {
  TReproductionTraceChannel,
  TReproductionTracePriority,
} from './typed';

export const REPRODUCTION_TRACE_SCHEMA_VERSION = 1 as const;
export const REPRODUCTION_TRACE_COPY_BUDGET_BYTES = 128 * 1024;
export const REPRODUCTION_TRACE_DOWNLOAD_BUDGET_BYTES = 2 * 1024 * 1024;
export const REPRODUCTION_TRACE_MAX_EVENTS = 12_000;
export const REPRODUCTION_TRACE_MARK_TAIL_MS = 5_000;
export const REPRODUCTION_TRACE_PASSIVE_INPUT_SAMPLE_RATE = 20;

export const REPRODUCTION_TRACE_CHANNELS: readonly TReproductionTraceChannel[] =
  Object.freeze([
    'input.dom',
    'input.engine',
    'picking',
    'transform',
    'editor',
    'document',
    'transport',
    'widget-host',
    'system',
  ]);

export const REPRODUCTION_TRACE_SMART_CHANNELS:
readonly TReproductionTraceChannel[] = REPRODUCTION_TRACE_CHANNELS;

export const REPRODUCTION_TRACE_PRIORITY_WEIGHT:
Readonly<Record<TReproductionTracePriority, number>> = Object.freeze({
  critical: 4,
  high: 3,
  normal: 2,
  low: 1,
});

export const REPRODUCTION_TRACE_SECRET_KEY_PATTERN =
  /authorization|cookie|credential|password|secret|token|api[-_]?key/i;

export const REPRODUCTION_TRACE_SECRET_VALUE_PATTERN =
  /\bbearer\s+\S+|(?:api[-_]?key|token|password|secret)=\S+|\bsk-[a-z0-9_-]{8,}/i;

export const REPRODUCTION_TRACE_BINARY_PATTERN =
  /^(?:data:|blob:)|(?:base64|arraybuffer|uint8array|binary)/i;
