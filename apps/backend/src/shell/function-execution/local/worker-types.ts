/** @file Private serializable protocol between the Bun host driver and one child. */

import type {
  TPortableResourceRequestWire,
  TPortableResourceResponseWire,
  TWidgetServerFunctionDescriptor,
} from '@omnidraw/sdk/contract';
import type {
  TDirectFunctionSubject,
  TFunctionFailure,
  TFunctionUsageMetrics,
} from '../types';

export type TFunctionCanonicalRegistration = Omit<
  TWidgetServerFunctionDescriptor,
  'exportName'
>;

export type TFunctionWorkerContext = Readonly<{
  invocationId: string;
  widgetKey: string;
  catalogGeneration: number;
  subject: TDirectFunctionSubject;
  deadlineAtMs: number;
}>;

export type THostToFunctionWorkerMessage =
  | Readonly<{
      type: 'inspect';
      requestId: string;
      moduleBytes: Uint8Array;
      moduleDigestSha256: string;
    }>
  | Readonly<{
      type: 'load';
      requestId: string;
      moduleBytes: Uint8Array;
      moduleDigestSha256: string;
      exportName: string;
      functionDescriptors: readonly TWidgetServerFunctionDescriptor[];
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
      response: TPortableResourceResponseWire;
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
      request: TPortableResourceRequestWire;
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
      metrics: TFunctionUsageMetrics;
    }>
  | Readonly<{
      type: 'failure';
      requestId: string;
      failure: TFunctionFailure;
      metrics: TFunctionUsageMetrics;
    }>
  | Readonly<{
      type: 'memory';
      rssBytes: number;
      cpuMs: number;
    }>;
