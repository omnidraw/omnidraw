import type { TJson, TWidgetError, TWidgetErrorPhase } from '@vibecanvas/service-db/model';

type TArgs = {
  phase: TWidgetErrorPhase;
  code: string;
  retryable: boolean;
  occurredAt?: string;
};

function fnSafeMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (typeof error === 'string' && error.trim()) return error.trim();
  return 'Unknown widget runtime error';
}

function fnSafeDetails(error: unknown): TJson | undefined {
  if (!error || typeof error !== 'object' || !('code' in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' || typeof code === 'number' ? { causeCode: code } : undefined;
}

export function fnNormalizeWidgetError(error: unknown, args: TArgs): TWidgetError {
  return {
    phase: args.phase,
    code: args.code,
    message: fnSafeMessage(error),
    details: fnSafeDetails(error),
    retryable: args.retryable,
    occurredAt: args.occurredAt,
  };
}
