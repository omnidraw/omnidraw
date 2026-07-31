/** @file Private serializable protocol between the Bun host driver and one child. */

import type { TResourceCall, TResourceCallResult } from '@omnidraw/resource-runtime';
import type { TWidgetServerFunctionDescriptor } from '@omnidraw/widget-contract';
import type { TFunctionFailure, TFunctionInvocationSubject, TUsageMetrics } from '../types';

export type TFunctionCanonicalRegistration = Omit<
  TWidgetServerFunctionDescriptor,
  'exportName'
>;

export type TFunctionWorkerContext = Readonly<{
  identity: Readonly<{
    orgId: string;
    accountId: string;
    roles: readonly string[];
  }>;
  invocationId: string;
  widgetDefinitionId: string;
  widgetRevisionId: string;
  subject: TFunctionInvocationSubject;
  attemptId: string;
  leaseEpoch: number;
  deadlineAtMs: number;
}>;

export type THostToFunctionWorkerMessage =
  | Readonly<{
      type: 'inspect';
      requestId: string;
      sourceBase64: string;
      sourceDigestSha256: string;
    }>
  | Readonly<{
      type: 'load';
      requestId: string;
      sourceBase64: string;
      sourceDigestSha256: string;
      exportName: string;
      canonicalRegistration: TFunctionCanonicalRegistration;
    }>
  | Readonly<{
      type: 'execute';
      requestId: string;
      input: unknown;
      context: TFunctionWorkerContext;
    }>
  | Readonly<{
      type: 'resource_result';
      requestId: string;
      callId: string;
      result?: TResourceCallResult;
      error?: Readonly<{ code?: string; message: string }>;
    }>
  | Readonly<{ type: 'cancel'; requestId: string; reason: string }>;

export type TFunctionWorkerToHostMessage =
  | Readonly<{ type: 'ready' }>
  | Readonly<{ type: 'loaded'; requestId: string }>
  | Readonly<{
      type: 'inspected';
      requestId: string;
      descriptors: readonly TWidgetServerFunctionDescriptor[];
    }>
  | Readonly<{
      type: 'load_error';
      requestId: string;
      failure: TFunctionFailure;
    }>
  | Readonly<{
      type: 'resource_call';
      requestId: string;
      callId: string;
      call: TResourceCall;
    }>
  | Readonly<{
      type: 'log';
      requestId: string;
      level: 'debug' | 'info' | 'warn' | 'error';
      values: readonly unknown[];
      byteSize: number;
    }>
  | Readonly<{
      type: 'result';
      requestId: string;
      output: unknown;
      outputByteSize: number;
      metrics: TUsageMetrics;
    }>
  | Readonly<{
      type: 'failure';
      requestId: string;
      failure: TFunctionFailure;
      metrics: TUsageMetrics;
    }>
  | Readonly<{
      type: 'memory';
      rssBytes: number;
      cpuMs: number;
    }>;
