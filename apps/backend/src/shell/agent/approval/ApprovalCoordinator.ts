import type {
  TApprovalDecision,
  TApprovalDecisionSource,
  TApprovalPolicy,
  TApprovalReviewer,
  TApprovalView,
  TProtectedApprovalKind,
  TToolAuthorizer,
} from './types';
import { fnNormalizeApprovalReviewDecision } from './fn.approval-policy';

type TPendingApproval = {
  view: TApprovalView;
  status: 'pending' | 'reviewing' | 'authorizing' | 'executing';
  abortSignal?: AbortSignal;
  onAbort?: () => void;
  approve: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

export type TApprovalCoordinatorEvent = Readonly<{
  type: 'created' | 'resolved' | 'canceled';
  approval: TApprovalView;
  decision?: TApprovalDecision;
  reason?: string;
}>;

type TApprovalCoordinatorConfig = {
  createId: () => string;
  now: () => Date;
  authorize?: TToolAuthorizer;
  policy?: (chatId: string) => TApprovalPolicy;
  reviewer?: TApprovalReviewer;
  onChanged?: (event: TApprovalCoordinatorEvent) => void;
};

type TRequestApprovalArgs<TArgs, TResult> = {
  chatId: string;
  toolCallId: string;
  kind: TProtectedApprovalKind;
  exactArgs: TArgs;
  summary: string;
  risk: TApprovalView['risk'];
  warnings?: string[];
  safeDetails: unknown;
  signal?: AbortSignal;
  execute: (args: Readonly<TArgs>) => Promise<TResult>;
};

export class ApprovalRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApprovalRejectedError';
  }
}

export class ApprovalCoordinator {
  readonly #createId: () => string;
  readonly #now: () => Date;
  readonly #authorize?: TToolAuthorizer;
  readonly #policy: (chatId: string) => TApprovalPolicy;
  readonly #reviewer?: TApprovalReviewer;
  readonly #onChanged?: TApprovalCoordinatorConfig['onChanged'];
  readonly #pending = new Map<string, TPendingApproval>();

  constructor(config: TApprovalCoordinatorConfig) {
    this.#createId = config.createId;
    this.#now = config.now;
    this.#authorize = config.authorize;
    this.#policy = config.policy ?? (() => Object.freeze({ mode: 'manual' }));
    this.#reviewer = config.reviewer;
    this.#onChanged = config.onChanged;
  }

  list(chatId: string): TApprovalView[] {
    return Array.from(this.#pending.values())
      .filter((pending) => pending.view.chatId === chatId && pending.status === 'pending')
      .map((pending) => structuredClone(pending.view))
      .sort((left, right) => left.createdAtSec.localeCompare(right.createdAtSec));
  }

  get(chatId: string, approvalId: string): TApprovalView | null {
    const pending = this.#pending.get(approvalId);
    return pending?.view.chatId === chatId && pending.status === 'pending'
      ? structuredClone(pending.view)
      : null;
  }

  request<TArgs, TResult>(args: TRequestApprovalArgs<TArgs, TResult>): Promise<TResult> {
    if (args.signal?.aborted) {
      return Promise.reject(new ApprovalRejectedError('Protected operation was canceled.'));
    }
    const id = this.#createId();
    if (this.#pending.has(id)) return Promise.reject(new Error('Approval ID collision.'));
    const policy = this.#policy(args.chatId);
    const exactArgs = this.#deepFreeze(structuredClone(args.exactArgs));
    const view: TApprovalView = this.#deepFreeze({
      id,
      chatId: args.chatId,
      toolCallId: args.toolCallId,
      kind: args.kind,
      summary: args.summary,
      risk: args.risk,
      warnings: [...(args.warnings ?? [])],
      details: structuredClone(args.safeDetails),
      createdAtSec: new Date(
        Math.floor(this.#now().getTime() / 1_000) * 1_000,
      ).toISOString(),
      policyMode: policy.mode,
    });

    return new Promise<TResult>((resolve, reject) => {
      const pending: TPendingApproval = {
        view,
        status: policy.mode === 'manual'
          ? 'pending'
          : policy.mode === 'ai-review'
            ? 'reviewing'
            : 'authorizing',
        abortSignal: args.signal,
        approve: () => args.execute(exactArgs),
        resolve: (value) => resolve(value as TResult),
        reject,
      };
      if (args.signal) {
        pending.onAbort = () => this.#cancel(id, 'Protected operation was canceled.');
        args.signal.addEventListener('abort', pending.onAbort, { once: true });
      }
      this.#pending.set(id, pending);

      if (policy.mode === 'manual') {
        this.#onChanged?.({ type: 'created', approval: structuredClone(view) });
        return;
      }
      if (policy.mode === 'always-approve') {
        void Promise.resolve().then(() => this.#settleDecision(
          pending,
          'approve',
          'policy',
        ));
        return;
      }
      void Promise.resolve().then(() => this.#review(pending, policy));
    });
  }

  async resolve(
    chatId: string,
    approvalId: string,
    decision: TApprovalDecision,
  ): Promise<{
    resolved: true;
    decision: TApprovalDecision;
    decisionSource: 'user';
  }> {
    const pending = this.#pending.get(approvalId);
    if (!pending || pending.view.chatId !== chatId) {
      throw new Error('Approval request was not found or is no longer pending.');
    }
    if (pending.status !== 'pending') {
      throw new Error('Approval request is already being resolved.');
    }
    pending.status = 'authorizing';
    await this.#settleDecision(pending, decision, 'user');
    return { resolved: true, decision, decisionSource: 'user' };
  }

  cancelChat(chatId: string, reason = 'Chat disconnected before approval.'): number {
    const ids = Array.from(this.#pending.entries())
      .filter(([, pending]) => pending.view.chatId === chatId && pending.status !== 'executing')
      .map(([id]) => id);
    for (const id of ids) this.#cancel(id, reason);
    return ids.length;
  }

  close(reason = 'Agent service stopped before approval.'): void {
    const ids = Array.from(this.#pending.entries())
      .filter(([, pending]) => pending.status !== 'executing')
      .map(([id]) => id);
    for (const id of ids) this.#cancel(id, reason);
  }

  async #review(
    pending: TPendingApproval,
    policy: Extract<TApprovalPolicy, Readonly<{ mode: 'ai-review' }>>,
  ): Promise<void> {
    try {
      if (!this.#reviewer) throw new Error('Approval reviewer is unavailable.');
      const result = fnNormalizeApprovalReviewDecision(await this.#reviewer.review({
        kind: pending.view.kind,
        summary: pending.view.summary,
        risk: pending.view.risk,
        warnings: pending.view.warnings,
        details: pending.view.details,
        model: policy.reviewerModel,
      }, pending.abortSignal));
      if (result === null) throw new Error('Approval reviewer returned malformed output.');
      if (this.#pending.get(pending.view.id) !== pending || pending.status !== 'reviewing') return;
      pending.status = 'authorizing';
      await this.#settleDecision(
        pending,
        result.decision,
        'reviewer',
        result.reason,
      );
    } catch {
      if (this.#pending.get(pending.view.id) !== pending || pending.status !== 'reviewing') return;
      pending.status = 'pending';
      this.#onChanged?.({
        type: 'created',
        approval: structuredClone(pending.view),
        reason: 'reviewer-unavailable',
      });
    }
  }

  async #settleDecision(
    pending: TPendingApproval,
    decision: TApprovalDecision,
    decisionSource: TApprovalDecisionSource,
    reviewerReason?: string,
  ): Promise<void> {
    if (this.#pending.get(pending.view.id) !== pending || pending.status !== 'authorizing') return;
    const finalView = this.#decisionView(pending.view, decisionSource, reviewerReason);
    if (decision === 'reject') {
      this.#finalize(pending);
      pending.reject(new ApprovalRejectedError(
        decisionSource === 'reviewer'
          ? `Protected operation was rejected by the reviewer: ${reviewerReason ?? 'No reason provided.'}`
          : 'Protected operation was rejected by the user.',
      ));
      this.#onChanged?.({
        type: 'resolved',
        approval: finalView,
        decision,
        ...(reviewerReason === undefined ? {} : { reason: reviewerReason }),
      });
      return;
    }

    let authorized: boolean;
    try {
      authorized = await this.#isAuthorized(pending.view.chatId);
    } catch (error) {
      if (
        this.#pending.get(pending.view.id) !== pending
        || pending.status !== 'authorizing'
      ) {
        if (decisionSource === 'user') {
          throw new Error('Approval request was canceled before execution.');
        }
        return;
      }
      this.#finalize(pending);
      pending.reject(new ApprovalRejectedError('Authorization could not be rechecked before approval execution.'));
      this.#onChanged?.({ type: 'canceled', approval: finalView, reason: 'authorization-check-failed' });
      if (decisionSource === 'user') throw error;
      return;
    }
    if (
      this.#pending.get(pending.view.id) !== pending
      || pending.status !== 'authorizing'
    ) {
      if (decisionSource === 'user') {
        throw new Error('Approval request was canceled before execution.');
      }
      return;
    }
    if (!authorized) {
      this.#finalize(pending);
      pending.reject(new ApprovalRejectedError('Authorization changed before approval execution.'));
      this.#onChanged?.({ type: 'canceled', approval: finalView, reason: 'authorization-changed' });
      if (decisionSource === 'user') {
        throw new Error('Not authorized to approve this protected operation.');
      }
      return;
    }

    pending.status = 'executing';
    try {
      const result = await pending.approve();
      this.#finalize(pending);
      pending.resolve(result);
      this.#onChanged?.({
        type: 'resolved',
        approval: finalView,
        decision,
        ...(reviewerReason === undefined ? {} : { reason: reviewerReason }),
      });
    } catch (error) {
      this.#finalize(pending);
      pending.reject(error instanceof Error ? error : new Error(String(error)));
      this.#onChanged?.({ type: 'canceled', approval: finalView, reason: 'execution-failed' });
      if (decisionSource === 'user') throw error;
    }
  }

  #cancel(id: string, reason: string): void {
    const pending = this.#pending.get(id);
    if (!pending || pending.status === 'executing') return;
    this.#finalize(pending);
    pending.reject(new ApprovalRejectedError(reason));
    this.#onChanged?.({ type: 'canceled', approval: structuredClone(pending.view), reason });
  }

  #finalize(pending: TPendingApproval): void {
    if (pending.abortSignal && pending.onAbort) {
      pending.abortSignal.removeEventListener('abort', pending.onAbort);
    }
    this.#pending.delete(pending.view.id);
  }

  #decisionView(
    view: TApprovalView,
    decisionSource: TApprovalDecisionSource,
    reviewerReason?: string,
  ): TApprovalView {
    return this.#deepFreeze({
      ...structuredClone(view),
      decisionSource,
      ...(reviewerReason === undefined
        ? {}
        : { reviewerReason: reviewerReason.slice(0, 500) }),
    });
  }

  async #isAuthorized(chatId: string): Promise<boolean> {
    if (!this.#authorize) return true;
    return this.#authorize({ chatId, toolName: 'approval.resolve' });
  }

  #deepFreeze<T>(value: T): T {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    for (const child of Object.values(value as Record<string, unknown>)) this.#deepFreeze(child);
    return Object.freeze(value);
  }
}
