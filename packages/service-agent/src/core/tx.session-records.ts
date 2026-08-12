import type { TSessionEntryManager, TWidgetDbChangeProposalRecord } from '../tools/types';
import { WIDGET_DB_CHANGE_PROPOSAL_CUSTOM_ENTRY_TYPE } from '../tools/CONSTANTS';

export type TPortal = {
  sessionManager: TSessionEntryManager;
};

export type TArgsAppendWidgetDbChangeProposalRecord = TWidgetDbChangeProposalRecord;

export function txAppendWidgetDbChangeProposalRecord(portal: TPortal, args: TArgsAppendWidgetDbChangeProposalRecord): TWidgetDbChangeProposalRecord {
  portal.sessionManager.appendCustomEntry(WIDGET_DB_CHANGE_PROPOSAL_CUSTOM_ENTRY_TYPE, args);
  return args;
}
