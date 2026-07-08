import type { TActorCandidateApprovalRecord, TActorCandidateRecord, TCandidateSessionManager, TWidgetEditSessionRecord } from '../tools/types';
import { ACTOR_CANDIDATE_APPROVED_CUSTOM_ENTRY_TYPE, ACTOR_CANDIDATE_CUSTOM_ENTRY_TYPE, WIDGET_DRAFT_MANIFEST_PATH_CUSTOM_ENTRY_TYPE, WIDGET_EDIT_SESSION_CUSTOM_ENTRY_TYPE } from '../tools/CONSTANTS';
import { fxLatestActorCandidateRecord } from './fx.session-candidate';

export type TPortal = {
  sessionManager: TCandidateSessionManager;
};

export type TArgs = Omit<TActorCandidateRecord, 'revision'>;
export type TArgsAppendActorCandidateApprovalRecord = TActorCandidateApprovalRecord;
export type TArgsAppendWidgetEditSessionRecord = TWidgetEditSessionRecord;
export type TArgsAppendDraftManifestPathRecord = {
  manifestPath: string;
};

export function txAppendActorCandidateRecord(portal: TPortal, args: TArgs): TActorCandidateRecord {
  const previous = fxLatestActorCandidateRecord({ sessionManager: portal.sessionManager });
  const record: TActorCandidateRecord = {
    ...args,
    revision: (previous?.revision ?? 0) + 1,
  };

  portal.sessionManager.appendCustomEntry(ACTOR_CANDIDATE_CUSTOM_ENTRY_TYPE, record);
  return record;
}

export function txAppendActorCandidateApprovalRecord(portal: TPortal, args: TArgsAppendActorCandidateApprovalRecord): TActorCandidateApprovalRecord {
  portal.sessionManager.appendCustomEntry(ACTOR_CANDIDATE_APPROVED_CUSTOM_ENTRY_TYPE, args);
  return args;
}

export function txAppendWidgetEditSessionRecord(portal: TPortal, args: TArgsAppendWidgetEditSessionRecord): TWidgetEditSessionRecord {
  portal.sessionManager.appendCustomEntry(WIDGET_EDIT_SESSION_CUSTOM_ENTRY_TYPE, args);
  return args;
}

export function txAppendDraftManifestPathRecord(portal: TPortal, args: TArgsAppendDraftManifestPathRecord): string {
  portal.sessionManager.appendCustomEntry(WIDGET_DRAFT_MANIFEST_PATH_CUSTOM_ENTRY_TYPE, args.manifestPath);
  return args.manifestPath;
}
