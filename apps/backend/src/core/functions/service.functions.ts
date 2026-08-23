import { Context, Schema, type Effect } from 'effect';
import {
  attachSemanticFailureCause,
  EMPTY_SEMANTIC_FAILURE_DETAILS,
  SemanticFailureDetails,
  type TSemanticFailureDetails,
  type TSemanticFailureFields,
} from '../semantic-failure';

export type TFunctionSubject = Readonly<{
  canvasId: string;
  elementId: string;
  widgetInstanceId: string;
}>;

export type TFunctionInvokeRequest = Readonly<{
  subject: TFunctionSubject;
  widgetKey: string;
  catalogGeneration: number;
  functionName: string;
  input: unknown;
}>;

export type TFunctionInvokeResult =
  | Readonly<{
    status: 'succeeded';
    output: unknown;
    diagnostics: TFunctionDiagnostics;
  }>
  | Readonly<{
    status: 'failed' | 'cancelled' | 'timed_out';
    output: null;
    failure: Readonly<{
      owner: 'user' | 'platform' | 'cancelled';
      code: string;
      message: string;
    }>;
    diagnostics: TFunctionDiagnostics;
  }>;

export type TFunctionDiagnostics = Readonly<{
  code: string | null;
  message: string | null;
  logByteSize: number;
  truncated: boolean;
}>;

export const FUNCTION_PROGRAM_ERROR_CODES = Object.freeze([
  'FUNCTION_INPUT_INVALID',
  'FUNCTION_INPUT_SCHEMA_INVALID',
  'FUNCTION_NOT_FOUND',
  'FUNCTION_REQUEST_INVALID',
  'FUNCTION_RESOURCE_UNAVAILABLE',
  'FUNCTION_REVISION_NOT_AVAILABLE',
  'FUNCTION_RUNTIME_UNAVAILABLE',
  'FUNCTION_UNAVAILABLE',
  'RESOURCE_EXHAUSTED',
  'WIDGET_CATALOG_CHANGED',
  'WIDGET_INSTANCE_ARCHIVED',
  'WIDGET_INSTANCE_FOREIGN',
  'WIDGET_INSTANCE_NOT_FOUND',
  'WIDGET_RESOURCE_BINDING_REQUIRED',
  'WIDGET_RESOURCE_BINDING_STALE',
  'WIDGET_RESOURCE_KIND_MISMATCH',
  'WIDGET_RESOURCE_NOT_READY',
] as const);

export type TFunctionProgramErrorCode = typeof FUNCTION_PROGRAM_ERROR_CODES[number];

export class FunctionProgramError extends Schema.TaggedError<FunctionProgramError>()(
  'FunctionProgramError',
  {
    code: Schema.Literals(FUNCTION_PROGRAM_ERROR_CODES),
    message: Schema.String,
    details: SemanticFailureDetails,
  },
) {
  constructor(
    codeOrFields: TFunctionProgramErrorCode | TSemanticFailureFields<TFunctionProgramErrorCode>,
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

export interface IFunctionAuthority {
  readonly invoke: (
    args: TFunctionInvokeRequest,
  ) => Effect.Effect<TFunctionInvokeResult, FunctionProgramError>;
}

export class FunctionAuthority extends Context.Service<FunctionAuthority, IFunctionAuthority>()(
  'omnidraw/backend/FunctionAuthority',
) {}
