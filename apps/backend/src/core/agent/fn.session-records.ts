import type {
  TAgentSessionEntry,
  TWidgetDbChangeProposalRecord,
} from './types';
import { WIDGET_DB_CHANGE_PROPOSAL_CUSTOM_ENTRY_TYPE } from './CONSTANTS';

export type TEffects = {
  entries: readonly TAgentSessionEntry[];
};

export type TArgs = Record<string, never>;

function fnLatestCustomEntryData<T>(args: Readonly<{
  entries: readonly TAgentSessionEntry[];
  customType: string;
}>): T | null {
  const { entries } = args;

  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry?.type !== 'custom' || entry.customType !== args.customType) {
      continue;
    }

    if (typeof entry.data === 'object' && entry.data !== null) {
      return entry.data as T;
    }
  }

  return null;
}

export type TArgsWidgetDbChangeProposal = {
  proposalId: string;
};

export function fnLatestWidgetDbChangeProposalRecord(args: Readonly<{
  entries: readonly TAgentSessionEntry[];
  proposalId: string;
}>): TWidgetDbChangeProposalRecord | null {
  const { entries } = args;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry?.type !== 'custom' || entry.customType !== WIDGET_DB_CHANGE_PROPOSAL_CUSTOM_ENTRY_TYPE) continue;
    const record = entry.data as TWidgetDbChangeProposalRecord | undefined;
    if (record?.id === args.proposalId) return record;
  }
  return null;
}

export { fnLatestCustomEntryData };
