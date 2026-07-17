export type TProtectedApprovalKind =
  | 'resource-create'
  | 'resource-update'
  | 'resource-delete'
  | 'resource-data-write';

export type TApprovalDecision = 'approve' | 'reject';

export type TApprovalView = {
  id: string;
  chatId: string;
  kind: TProtectedApprovalKind;
  summary: string;
  risk: 'medium' | 'high';
  warnings: string[];
  details: unknown;
  createdAt: string;
  expiresAt: string;
};

export type TToolAuthorizationContext = {
  accountId?: string;
  requestId?: string;
};

export type TToolAuthorizationRequest = {
  chatId: string;
  toolName: string;
  context: TToolAuthorizationContext;
};

export type TToolAuthorizer = (request: TToolAuthorizationRequest) => boolean | Promise<boolean>;
