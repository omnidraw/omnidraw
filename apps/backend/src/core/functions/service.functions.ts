import { Context, type Effect } from 'effect';

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

export class FunctionProgramError extends Error {
  readonly code: string;
  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'FunctionProgramError';
    this.code = code;
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
