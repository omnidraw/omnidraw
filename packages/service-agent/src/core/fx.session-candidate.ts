import type { TActorCandidateApprovalRecord, TActorCandidateRecord, TCandidateSessionManager } from '../tools/types';
import { ACTOR_CANDIDATE_APPROVED_CUSTOM_ENTRY_TYPE, ACTOR_CANDIDATE_CUSTOM_ENTRY_TYPE } from '../tools/CONSTANTS';

export type TPortal = {
  sessionManager: Pick<TCandidateSessionManager, 'getEntries'>;
};

export type TArgs = Record<string, never>;

function fxLatestCustomEntryData<T>(portal: TPortal, customType: string): T | null {
  const entries = portal.sessionManager.getEntries();

  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry?.type !== 'custom' || entry.customType !== customType) {
      continue;
    }

    if (typeof entry.data === 'object' && entry.data !== null) {
      return entry.data as T;
    }
  }

  return null;
}

export function fxLatestActorCandidateRecord(portal: TPortal, args?: TArgs): TActorCandidateRecord | null {
  void args;
  return fxLatestCustomEntryData<TActorCandidateRecord>(portal, ACTOR_CANDIDATE_CUSTOM_ENTRY_TYPE);
}

export function fxLatestActorCandidateApprovalRecord(portal: TPortal, args?: TArgs): TActorCandidateApprovalRecord | null {
  void args;
  return fxLatestCustomEntryData<TActorCandidateApprovalRecord>(portal, ACTOR_CANDIDATE_APPROVED_CUSTOM_ENTRY_TYPE);
}
