export type TProtectedApprovalKind =
  | 'resource-create'
  | 'resource-update'
  | 'resource-delete'
  | 'resource-data-write';

export type TApprovalDecision = 'approve' | 'reject';

export type TApprovalMode = 'always-approve' | 'ai-review' | 'manual';
export type TApprovalDecisionSource = 'policy' | 'reviewer' | 'user';

export type TApprovalPolicy =
  | Readonly<{ mode: 'always-approve' }>
  | Readonly<{ mode: 'manual' }>
  | Readonly<{
      mode: 'ai-review';
      reviewerModel: Readonly<{ provider: string; modelId: string }>;
    }>;

export type TApprovalView = {
  id: string;
  chatId: string;
  toolCallId: string;
  kind: TProtectedApprovalKind;
  summary: string;
  risk: 'medium' | 'high';
  warnings: string[];
  details: unknown;
  createdAt: string;
  policyMode: TApprovalMode;
  decisionSource?: TApprovalDecisionSource;
  reviewerReason?: string;
};

export type TApprovalReviewInput = Readonly<{
  kind: TProtectedApprovalKind;
  summary: string;
  risk: TApprovalView['risk'];
  warnings: readonly string[];
  details: unknown;
  model: Readonly<{ provider: string; modelId: string }>;
}>;

export type TApprovalReviewDecision = Readonly<{
  decision: TApprovalDecision;
  reason: string;
}>;

export type TApprovalReviewer = Readonly<{
  review(
    input: TApprovalReviewInput,
    signal?: AbortSignal,
  ): Promise<TApprovalReviewDecision>;
}>;

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
