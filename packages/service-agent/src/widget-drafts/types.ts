import type { TActorData, TActorState, TVibecanvasJson } from '@vibecanvas/service-actor/core/types';

export type TWidgetDraftValidation = {
  status: 'unknown' | 'valid' | 'invalid';
  errors: string[];
  warnings: string[];
  validatedRevision?: string;
};

export type TWidgetDraftSummary = {
  draftId: string;
  name: string;
  displayName: string;
  state: 'new' | 'modified';
  revision: string;
  updatedAt: string;
  validation: TWidgetDraftValidation;
  previewAvailable: boolean;
  publishReady: boolean;
};

export type TWidgetPreviewReady = {
  ready: true;
  draftId: string;
  name: string;
  revision: string;
  currentRevision: string;
  stale: boolean;
  manifest: TVibecanvasJson;
  sources: Record<string, string>;
  snapshot: {
    state: TActorState;
    context: TActorData;
  };
  diagnostics: string[];
};

export type TWidgetPreviewFailureReason =
  | 'not-found'
  | 'not-built'
  | 'stale-revision'
  | 'validation-failed'
  | 'manifest-invalid'
  | 'source-missing'
  | 'resource-binding-invalid'
  | 'build-failed';

export type TWidgetPreviewResult = TWidgetPreviewReady | {
  ready: false;
  draftId: string;
  revision?: string;
  currentRevision?: string;
  reason: TWidgetPreviewFailureReason;
  message: string;
  diagnostics: string[];
};

export type TWidgetPreviewSendResult =
  | { ready: true; revision: string; messageId: string; snapshot: TWidgetPreviewReady['snapshot'] }
  | Exclude<TWidgetPreviewResult, { ready: true }>;

export type TWidgetPublishResult =
  | {
      published: true;
      draftId: string;
      revision: string;
      definitionName: string;
      manifest: TVibecanvasJson;
    }
  | {
      published: false;
      draftId: string;
      reason: 'not-found' | 'stale-revision' | 'validation-failed' | 'permission-failed' | 'publication-failed' | 'recovery-failed';
      message: string;
      currentRevision?: string;
      errors: string[];
      warnings: string[];
    };
