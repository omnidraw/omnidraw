/** @file Public contracts for one bounded, synchronous server-function call. */

import type { IResourceGateway } from '#backend/shell/resources';
import type { TWidgetServerFunctionDescriptor } from '@omnidraw/sdk/contract';

export type TFunctionMemoryTier = 'small' | 'medium' | 'large';

export type TDirectFunctionSubject = Readonly<{
  canvasId: string;
  elementId: string;
  widgetInstanceId: string;
}>;

/** Exact filesystem-catalog definition captured for one live call. */
export type TDirectFunctionDefinition = Readonly<{
  widgetKey: string;
  catalogGeneration: number;
  runtimeAbi: string;
  artifactDigestSha256: string;
  descriptor: TWidgetServerFunctionDescriptor;
}>;

export type TDirectFunctionCall = Readonly<{
  id: string;
  subject: TDirectFunctionSubject;
  definition: TDirectFunctionDefinition;
  input: unknown;
  deadlineAtMs: number;
}>;

export type TFunctionFailure = Readonly<{
  owner: 'user' | 'platform' | 'cancelled';
  code: string;
  message: string;
}>;

export type TFunctionDiagnostics = Readonly<{
  code: string | null;
  message: string | null;
  logByteSize: number;
  truncated: boolean;
}>;

export type TDirectFunctionResult =
  | Readonly<{
      status: 'succeeded';
      output: unknown;
      diagnostics: TFunctionDiagnostics;
    }>
  | Readonly<{
      status: 'failed' | 'cancelled' | 'timed_out';
      output: null;
      failure: TFunctionFailure;
      diagnostics: TFunctionDiagnostics;
    }>;

export type TDirectFunctionInvocationRequest = Readonly<{
  subject: TDirectFunctionSubject;
  definition: TDirectFunctionDefinition;
  artifact: Uint8Array;
  input: unknown;
  createResources(call: TDirectFunctionCall): IResourceGateway | Promise<IResourceGateway>;
  signal?: AbortSignal;
}>;

export type TFunctionUsageMetrics = Readonly<{
  activeWallMs: number;
  cpuMs: number;
  allocatedMemoryByteMs: number;
  peakRssBytes: number;
}>;

export type TFunctionSandboxHandle = Readonly<{
  driver: string;
  id: string;
}>;

export type TFunctionSandboxStartRequest = Readonly<{
  deadlineAtMs: number;
  observeMetrics(metrics: TFunctionUsageMetrics): void;
}>;

export type TFunctionSandboxExecutionResult =
  | Readonly<{
      status: 'succeeded';
      output: unknown;
      outputByteSize: number;
      logByteSize: number;
    }>
  | Readonly<{
      status: 'failed';
      failure: TFunctionFailure;
      outputByteSize: number;
      logByteSize: number;
    }>;

/** In-memory permit. It is deleted as soon as its one write settles. */
export type TEphemeralResourceWritePermit = Readonly<{
  id: string;
  resourceId: string;
  invocationId: string;
  operation: string;
  operationId: string;
  operationFingerprintSha256: string;
  expiresAtMs: number;
}>;
