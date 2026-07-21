/**
 * @file Applies the platform-owned retry policy to a completed attempt.
 */

import type { TAttemptStatus, TFailureOwner } from '../types';

type TArgs = Readonly<{
  status: TAttemptStatus;
  failureOwner: TFailureOwner | null;
  attemptNumber: number;
  maxAttempts: number;
}>;

export function fnFunctionAttemptShouldRetry(args: TArgs): boolean {
  if (args.attemptNumber >= args.maxAttempts) return false;
  if (args.failureOwner !== 'platform') return false;
  return args.status === 'failed' || args.status === 'timed_out' || args.status === 'lost';
}
