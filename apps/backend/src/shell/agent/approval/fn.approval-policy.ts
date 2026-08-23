/** @file Pure normalization for persisted protected-operation approval policy. */

import type { TApprovalPolicy, TApprovalReviewDecision } from './types';

export function fnNormalizeApprovalPolicy(value: unknown): TApprovalPolicy {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return Object.freeze({ mode: 'manual' });
  }
  const record = value as Readonly<Record<string, unknown>>;
  if (record.mode === 'always-approve' || record.mode === 'manual') {
    return Object.freeze({ mode: record.mode });
  }
  if (
    record.mode === 'ai-review'
    && record.reviewerModel !== null
    && typeof record.reviewerModel === 'object'
    && !Array.isArray(record.reviewerModel)
  ) {
    const model = record.reviewerModel as Readonly<Record<string, unknown>>;
    if (
      typeof model.provider === 'string'
      && model.provider.trim().length > 0
      && typeof model.modelId === 'string'
      && model.modelId.trim().length > 0
    ) {
      return Object.freeze({
        mode: 'ai-review',
        reviewerModel: Object.freeze({
          provider: model.provider,
          modelId: model.modelId,
        }),
      });
    }
  }
  return Object.freeze({ mode: 'manual' });
}

export function fnNormalizeApprovalReviewDecision(
  value: unknown,
): TApprovalReviewDecision | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as Readonly<Record<string, unknown>>;
  if (
    (record.decision !== 'approve' && record.decision !== 'reject')
    || typeof record.reason !== 'string'
    || record.reason.trim().length === 0
    || record.reason.length > 500
    || Object.keys(record).some((key) => key !== 'decision' && key !== 'reason')
  ) return null;
  return Object.freeze({
    decision: record.decision,
    reason: record.reason.trim(),
  });
}
