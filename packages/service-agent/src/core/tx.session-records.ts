import type { TSessionEntryManager, TWidgetDbChangeProposalRecord, TWidgetDraftResourceBindingSelectionRecord, TWidgetEditSessionRecord, TWidgetResourceSelectionRecord } from '../tools/types';
import { WIDGET_DB_CHANGE_PROPOSAL_CUSTOM_ENTRY_TYPE, WIDGET_DRAFT_RESOURCE_BINDING_SELECTION_CUSTOM_ENTRY_TYPE, WIDGET_EDIT_SESSION_CUSTOM_ENTRY_TYPE, WIDGET_RESOURCE_SELECTION_CUSTOM_ENTRY_TYPE } from '../tools/CONSTANTS';

export type TPortal = {
  sessionManager: TSessionEntryManager;
};

export type TArgsAppendWidgetEditSessionRecord = TWidgetEditSessionRecord;
export type TArgsAppendWidgetResourceSelectionRecord = TWidgetResourceSelectionRecord;
export type TArgsAppendWidgetDraftResourceBindingSelectionRecord = TWidgetDraftResourceBindingSelectionRecord;
export type TArgsAppendWidgetDbChangeProposalRecord = TWidgetDbChangeProposalRecord;

export function txAppendWidgetEditSessionRecord(portal: TPortal, args: TArgsAppendWidgetEditSessionRecord): TWidgetEditSessionRecord {
  portal.sessionManager.appendCustomEntry(WIDGET_EDIT_SESSION_CUSTOM_ENTRY_TYPE, args);
  return args;
}

export function txAppendWidgetResourceSelectionRecord(portal: TPortal, args: TArgsAppendWidgetResourceSelectionRecord): TWidgetResourceSelectionRecord {
  portal.sessionManager.appendCustomEntry(WIDGET_RESOURCE_SELECTION_CUSTOM_ENTRY_TYPE, args);
  return args;
}

export function txAppendWidgetDraftResourceBindingSelectionRecord(portal: TPortal, args: TArgsAppendWidgetDraftResourceBindingSelectionRecord): TWidgetDraftResourceBindingSelectionRecord {
  portal.sessionManager.appendCustomEntry(WIDGET_DRAFT_RESOURCE_BINDING_SELECTION_CUSTOM_ENTRY_TYPE, args);
  return args;
}

export function txAppendWidgetDbChangeProposalRecord(portal: TPortal, args: TArgsAppendWidgetDbChangeProposalRecord): TWidgetDbChangeProposalRecord {
  portal.sessionManager.appendCustomEntry(WIDGET_DB_CHANGE_PROPOSAL_CUSTOM_ENTRY_TYPE, args);
  return args;
}
