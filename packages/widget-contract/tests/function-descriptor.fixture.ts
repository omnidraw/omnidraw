import type {
  IWidgetServerFunctionDescriptorExtractor,
  TWidgetServerFunctionDescriptor,
} from '../src';

export const TEST_SERVER_FUNCTION_DESCRIPTOR: TWidgetServerFunctionDescriptor = Object.freeze({
  schemaVersion: 1,
  exportName: 'run',
  modulePath: 'server/run.server.ts',
  effect: 'fn',
  inputSchema: Object.freeze({ type: 'object', additionalProperties: false }),
  outputSchema: Object.freeze({ type: 'object', additionalProperties: false }),
  resources: Object.freeze([]),
  limits: Object.freeze({
    timeoutMs: 5_000,
    memoryTier: 'small',
    outputByteLimit: 262_144,
    logByteLimit: 65_536,
  }),
  retry: Object.freeze({
    mode: 'none',
    maxAttempts: 1,
    initialBackoffMs: 0,
    maxBackoffMs: 0,
  }),
});

export const TEST_FUNCTION_DESCRIPTOR_EXTRACTOR: IWidgetServerFunctionDescriptorExtractor =
  Object.freeze({
    extractServerFunctionDescriptors: async () => Object.freeze([
      TEST_SERVER_FUNCTION_DESCRIPTOR,
    ]),
  });
