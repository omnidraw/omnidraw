import { Schema } from 'effect';
import type { Json } from 'effect/Schema';

/** JSON-safe, structured detail carried by expected semantic failures. */
export const SemanticFailureDetails = Schema.Record(Schema.String, Schema.Json);

export type TSemanticFailureDetails = Readonly<Record<string, Json>>;

export const EMPTY_SEMANTIC_FAILURE_DETAILS: TSemanticFailureDetails = Object.freeze({});

export type TSemanticFailureFields<Code extends string> = Readonly<{
  code: Code;
  message: string;
  details: TSemanticFailureDetails;
}>;

/** Keep a shell cause useful for local diagnostics without putting it on the wire. */
export function attachSemanticFailureCause(error: Error, cause: unknown): void {
  if (cause === undefined) return;
  Object.defineProperty(error, 'cause', {
    configurable: true,
    enumerable: false,
    value: cause,
    writable: true,
  });
}
