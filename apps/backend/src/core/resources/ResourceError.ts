/**
 * @file Stable resource-domain errors and safe serialization at transport boundaries.
 */

import { Schema } from 'effect';
import {
  attachSemanticFailureCause,
  EMPTY_SEMANTIC_FAILURE_DETAILS,
  SemanticFailureDetails,
  type TSemanticFailureDetails,
  type TSemanticFailureFields,
} from '../semantic-failure';
import { RESOURCE_ERROR_CODES, type TResourceErrorCode, type TSafeResourceError } from './types';

const SENSITIVE_DETAIL_KEY = /(?:credential|key_material|parameter|password|path|secret|sql|token|value)/i;

export class ResourceError extends Schema.TaggedError<ResourceError>()(
  'ResourceError',
  {
    code: Schema.Literals(RESOURCE_ERROR_CODES),
    message: Schema.String,
    details: SemanticFailureDetails,
  },
) {
  constructor(
    codeOrFields: TResourceErrorCode | TSemanticFailureFields<TResourceErrorCode>,
    message?: string,
    details: TSemanticFailureDetails = EMPTY_SEMANTIC_FAILURE_DETAILS,
    options?: ErrorOptions,
  ) {
    super(typeof codeOrFields === 'string'
      ? { code: codeOrFields, message: message ?? codeOrFields, details }
      : codeOrFields);
    attachSemanticFailureCause(this, options?.cause);
  }
}

function safeDetailValue(value: unknown, seen: Set<object>): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'object' || seen.has(value)) return undefined;

  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item) => safeDetailValue(item, seen)).filter((item) => item !== undefined);
    }
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (SENSITIVE_DETAIL_KEY.test(key)) continue;
      const safe = safeDetailValue(item, seen);
      if (safe !== undefined) result[key] = safe;
    }
    return result;
  } finally {
    seen.delete(value);
  }
}

export function toResourceError(
  error: unknown,
  fallbackCode: TResourceErrorCode,
  fallbackMessage: string,
): ResourceError {
  if (error instanceof ResourceError) return error;

  const coded = error as { code?: unknown; message?: unknown };
  if (
    (coded?.code === 'RESOURCE_NAME_INVALID'
      || coded?.code === 'RESOURCE_NAME_CONFLICT')
    && typeof coded.message === 'string'
  ) {
    return new ResourceError(coded.code, coded.message);
  }
  return new ResourceError(fallbackCode, fallbackMessage);
}

export function toSafeResourceError(error: unknown): TSafeResourceError {
  if (!(error instanceof ResourceError)) {
    return {
      code: 'RESOURCE_PROVIDER_UNAVAILABLE',
      message: 'Resource operation failed.',
    };
  }

  const details = safeDetailValue(error.details, new Set()) as TSemanticFailureDetails;
  return {
    code: error.code,
    message: error.message,
    ...(Object.keys(details).length > 0 ? { details } : {}),
  };
}
