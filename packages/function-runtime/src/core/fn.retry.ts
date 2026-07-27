/**
 * @file Applies the platform-owned retry policy to a completed attempt.
 */

import type { TAttemptStatus, TFailureOwner } from '../types';
import type { TFunctionRetryPolicy } from '../types';

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

export function fnFunctionRetryDelayMs(
  policy: TFunctionRetryPolicy,
  completedAttemptNumber: number,
): number {
  if (completedAttemptNumber < 1 || policy.initialBackoffMs <= 0) return 0;
  const exponent = Math.min(30, completedAttemptNumber - 1);
  return Math.min(policy.maxBackoffMs, policy.initialBackoffMs * (2 ** exponent));
}
