/**
 * @file Defines deterministic invocation and attempt state-machine transitions.
 */

import type { TAttemptStatus, TInvocationStatus } from '../types';

export function fnInvocationIsTerminal(status: TInvocationStatus): boolean {
  return status === 'succeeded'
    || status === 'failed'
    || status === 'cancelled'
    || status === 'timed_out';
}

export function fnInvocationCanTransition(
  current: TInvocationStatus,
  next: TInvocationStatus,
): boolean {
  switch (current) {
    case 'queued':
      return next === 'claimed' || next === 'cancelled' || next === 'timed_out';
    case 'claimed':
      return next === 'queued' || next === 'running' || next === 'cancelled' || next === 'timed_out';
    case 'running':
      return fnInvocationIsTerminal(next);
    default:
      return false;
  }
}

export function fnAttemptIsTerminal(status: TAttemptStatus): boolean {
  return status === 'succeeded'
    || status === 'failed'
    || status === 'cancelled'
    || status === 'timed_out'
    || status === 'lost';
}

export function fnAttemptCanTransition(
  current: TAttemptStatus,
  next: TAttemptStatus,
): boolean {
  if (current === 'starting') {
    return next === 'running'
      || next === 'failed'
      || next === 'cancelled'
      || next === 'timed_out'
      || next === 'lost';
  }
  if (current === 'running') return fnAttemptIsTerminal(next);
  return false;
}
