import type { TSessionEntryManager } from './tools/types';
import type { TWidgetDbChangeProposalRecord } from '../../core/agent/types';
import { WIDGET_DB_CHANGE_PROPOSAL_CUSTOM_ENTRY_TYPE } from '../../core/agent/CONSTANTS';

export type TEffects = {
  sessionManager: TSessionEntryManager;
};

export type TArgsAppendWidgetDbChangeProposalRecord = TWidgetDbChangeProposalRecord;

export function appendWidgetDbChangeProposalRecord(effects: TEffects, args: TArgsAppendWidgetDbChangeProposalRecord): TWidgetDbChangeProposalRecord {
  effects.sessionManager.appendCustomEntry(WIDGET_DB_CHANGE_PROPOSAL_CUSTOM_ENTRY_TYPE, args);
  return args;
}
