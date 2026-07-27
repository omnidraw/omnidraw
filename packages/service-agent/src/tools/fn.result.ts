import { TOOL_ERROR_DETAILS_MARKER } from './CONSTANTS';

const MODEL_TEXT_MAX_LENGTH = 128_000;
const MODEL_STRING_MAX_LENGTH = 32_000;
const MODEL_ARRAY_MAX_LENGTH = 500;
const MODEL_OBJECT_MAX_KEYS = 200;
const MODEL_DATA_MAX_DEPTH = 12;
const SUMMARY_MAX_LENGTH = 4_000;

export type TToolSuccess<TModelData, TDetails = TModelData> = {
  summary: string;
  modelData?: TModelData;
  details?: TDetails;
};

export type TToolFailure<TModelData = never, TDetails = TModelData> = {
  code: string;
  message: string;
  retryable?: boolean;
  modelData?: TModelData;
  details?: TDetails;
};

type TBoundState = {
  seen: Set<object>;
  truncated: boolean;
};

function fnBoundModelValue(value: unknown, depth: number, state: TBoundState): unknown {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (typeof value === 'string') {
    if (value.length <= MODEL_STRING_MAX_LENGTH) return value;
    state.truncated = true;
    return `${value.slice(0, MODEL_STRING_MAX_LENGTH)}\n[truncated]`;
  }
  if (typeof value !== 'object') return String(value);
  if (depth >= MODEL_DATA_MAX_DEPTH || state.seen.has(value)) {
    state.truncated = true;
    return '[truncated]';
  }

  state.seen.add(value);
  try {
    if (Array.isArray(value)) {
      if (value.length > MODEL_ARRAY_MAX_LENGTH) state.truncated = true;
      return value.slice(0, MODEL_ARRAY_MAX_LENGTH).map((item) => fnBoundModelValue(item, depth + 1, state));
    }
    const entries = Object.entries(value);
    if (entries.length > MODEL_OBJECT_MAX_KEYS) state.truncated = true;
    return Object.fromEntries(entries.slice(0, MODEL_OBJECT_MAX_KEYS).map(([key, item]) => [
      key,
      fnBoundModelValue(item, depth + 1, state),
    ]));
  } finally {
    state.seen.delete(value);
  }
}

export function fnBoundToolModelData<T>(modelData: T): { data: unknown; truncated: boolean } {
  const state: TBoundState = { seen: new Set(), truncated: false };
  const data = fnBoundModelValue(modelData, 0, state);
  const serialized = JSON.stringify(data);
  if (serialized.length <= MODEL_TEXT_MAX_LENGTH) return { data, truncated: state.truncated };
  return {
    data: {
      truncated: true,
      preview: `${serialized.slice(0, MODEL_TEXT_MAX_LENGTH - 100)}\n[truncated]`,
    },
    truncated: true,
  };
}

export function fnToolSuccess<TModelData = never, TDetails = TModelData>(
  options: TToolSuccess<TModelData, TDetails>,
) {
  const summary = options.summary.slice(0, SUMMARY_MAX_LENGTH);
  const content = options.modelData === undefined
    ? summary
    : `${summary}\n\nModel data:\n${JSON.stringify(fnBoundToolModelData(options.modelData).data, null, 2)}`;
  return {
    content: [{ type: 'text' as const, text: content }],
    details: options.details ?? {},
  };
}

export function fnToolError<TModelData = never, TDetails = TModelData>(
  options: TToolFailure<TModelData, TDetails>,
) {
  const modelData = {
    error: {
      code: options.code,
      message: options.message.slice(0, SUMMARY_MAX_LENGTH),
      retryable: options.retryable ?? false,
    },
    ...(options.modelData === undefined ? {} : { data: options.modelData }),
  };
  return {
    content: [{
      type: 'text' as const,
      text: `Tool error.\n\nModel data:\n${JSON.stringify(fnBoundToolModelData(modelData).data, null, 2)}`,
    }],
    details: {
      ...(typeof options.details === 'object' && options.details !== null
        ? options.details
        : {}),
      [TOOL_ERROR_DETAILS_MARKER]: true,
    },
    isError: true,
  };
}

export function fnIsStructuredToolErrorDetails(
  details: unknown,
): boolean {
  return typeof details === 'object'
    && details !== null
    && TOOL_ERROR_DETAILS_MARKER in details;
}
