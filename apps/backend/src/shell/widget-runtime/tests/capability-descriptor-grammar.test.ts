import { describe, expect, test } from 'bun:test';
import {
  fnOmnidrawCollaborativeStateDescriptor,
  fnOmnidrawServerFunctionDescriptor,
} from '../capabilities';

const INPUT_SCHEMA = Object.freeze({
  format: 'capsule-schema-v1' as const,
  hash: `sha256:${'1'.repeat(64)}` as const,
});
const OUTPUT_SCHEMA = Object.freeze({
  format: 'capsule-schema-v1' as const,
  hash: `sha256:${'2'.repeat(64)}` as const,
});

function expectCapsuleErrorCodeGrammar(codes: readonly string[] | undefined): void {
  expect(codes).toBeDefined();
  expect(codes?.length).toBeGreaterThan(0);
  for (const code of codes ?? []) {
    expect(code).toMatch(/^[a-z][a-z0-9_]{0,63}$/);
  }
}

describe('Omnidraw capability descriptor grammar', () => {
  test('emits Capsule-valid error codes for function and collaboration descriptors', () => {
    const functions = fnOmnidrawServerFunctionDescriptor({
      descriptorDigestSha256: 'a'.repeat(64),
      functions: [{
        function: {
          schemaVersion: 1,
          exportName: 'double',
          effect: 'fn',
          inputSchema: { type: 'object' },
          outputSchema: { type: 'object' },
          resources: [],
          limits: {
            timeoutMs: 1_000,
            memoryTier: 'small',
            outputByteLimit: 4_096,
            logByteLimit: 0,
          },
        },
        inputSchema: INPUT_SCHEMA,
        outputSchema: OUTPUT_SCHEMA,
      }],
    });
    const collaboration = fnOmnidrawCollaborativeStateDescriptor({
      nullSchema: INPUT_SCHEMA,
      changeSchema: INPUT_SCHEMA,
      snapshotSchema: OUTPUT_SCHEMA,
    });

    expectCapsuleErrorCodeGrammar(functions.errorCodes);
    expectCapsuleErrorCodeGrammar(collaboration.errorCodes);
  });
});
