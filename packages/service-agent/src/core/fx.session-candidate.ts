import type { TActorCandidateApprovalRecord, TActorCandidateRecord, TCandidateSessionManager, TWidgetDbChangeProposalRecord, TWidgetEditSessionRecord, TWidgetResourceSelectionRecord } from '../tools/types';
import { ACTOR_CANDIDATE_APPROVED_CUSTOM_ENTRY_TYPE, ACTOR_CANDIDATE_CUSTOM_ENTRY_TYPE, WIDGET_DB_CHANGE_PROPOSAL_CUSTOM_ENTRY_TYPE, WIDGET_EDIT_SESSION_CUSTOM_ENTRY_TYPE, WIDGET_RESOURCE_SELECTION_CUSTOM_ENTRY_TYPE } from '../tools/CONSTANTS';

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

export function fxLatestWidgetEditSessionRecord(portal: TPortal, args?: TArgs): TWidgetEditSessionRecord | null {
  void args;
  return fxLatestCustomEntryData<TWidgetEditSessionRecord>(portal, WIDGET_EDIT_SESSION_CUSTOM_ENTRY_TYPE);
}

export function fxLatestWidgetResourceSelectionRecord(portal: TPortal, args: TArgs): TWidgetResourceSelectionRecord | null {
  void args;
  return fxLatestCustomEntryData<TWidgetResourceSelectionRecord>(portal, WIDGET_RESOURCE_SELECTION_CUSTOM_ENTRY_TYPE);
}

export type TArgsWidgetDbChangeProposal = {
  proposalId: string;
};

export function fxLatestWidgetDbChangeProposalRecord(portal: TPortal, args: TArgsWidgetDbChangeProposal): TWidgetDbChangeProposalRecord | null {
  const entries = portal.sessionManager.getEntries();
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry?.type !== 'custom' || entry.customType !== WIDGET_DB_CHANGE_PROPOSAL_CUSTOM_ENTRY_TYPE) continue;
    const record = entry.data as TWidgetDbChangeProposalRecord | undefined;
    if (record?.id === args.proposalId) return record;
  }
  return null;
}
