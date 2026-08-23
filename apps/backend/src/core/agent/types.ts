export type TValidationResult = {
  ok: boolean;
  errors: string[];
  warnings: string[];
};

export type TWidgetDbChangeProposalRecord = {
  id: string;
  resourceId: string;
  resourceName: string;
  sql: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  proposedAt: string;
  resolvedAt?: string;
  draftId?: string;
  applyId?: string;
  warnings?: string[];
};

export type TAgentSessionEntry = Readonly<{
  type: string;
  customType?: string;
  data?: unknown;
}>;
