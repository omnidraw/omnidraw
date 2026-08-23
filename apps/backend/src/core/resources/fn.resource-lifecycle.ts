/**
 * @file Defines deterministic resource catalog lifecycle transitions.
 */

import type { TResourceStatus } from './types';

export function fnResourceStatusCanTransition(
  current: TResourceStatus,
  next: TResourceStatus,
): boolean {
  if (current === next) return true;
  switch (current) {
    case 'created':
      return next === 'provisioning' || next === 'error' || next === 'deleting';
    case 'provisioning':
      return next === 'ready' || next === 'error' || next === 'deleting';
    case 'ready':
      return next === 'migrating' || next === 'error' || next === 'deleting';
    case 'migrating':
      return next === 'ready' || next === 'error' || next === 'deleting';
    case 'error':
      return next === 'provisioning' || next === 'deleting';
    case 'deleting':
      return false;
  }
}
