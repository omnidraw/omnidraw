import type { TSessionEntryManager, TWidgetDbChangeProposalRecord, TWidgetResourceSelectionRecord } from '../tools/types';
import { WIDGET_DB_CHANGE_PROPOSAL_CUSTOM_ENTRY_TYPE, WIDGET_RESOURCE_SELECTION_CUSTOM_ENTRY_TYPE } from '../tools/CONSTANTS';

export type TPortal = {
  sessionManager: TSessionEntryManager;
};

export type TArgsAppendWidgetResourceSelectionRecord = TWidgetResourceSelectionRecord;
export type TArgsAppendWidgetDbChangeProposalRecord = TWidgetDbChangeProposalRecord;

export function txAppendWidgetResourceSelectionRecord(portal: TPortal, args: TArgsAppendWidgetResourceSelectionRecord): TWidgetResourceSelectionRecord {
  portal.sessionManager.appendCustomEntry(WIDGET_RESOURCE_SELECTION_CUSTOM_ENTRY_TYPE, args);
  return args;
}

export function txAppendWidgetDbChangeProposalRecord(portal: TPortal, args: TArgsAppendWidgetDbChangeProposalRecord): TWidgetDbChangeProposalRecord {
  portal.sessionManager.appendCustomEntry(WIDGET_DB_CHANGE_PROPOSAL_CUSTOM_ENTRY_TYPE, args);
  return args;
}
