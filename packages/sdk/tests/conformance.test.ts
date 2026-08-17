import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import {
  WIDGET_SDK_ARTIFACT_ADMISSION_VECTORS,
  WIDGET_SDK_FUNCTION_SCENARIOS,
  WIDGET_SDK_MODULE_ADMISSION_VECTORS,
  WIDGET_SDK_RESOURCE_PROVIDER_SCENARIOS,
  WIDGET_SDK_RESOURCE_SCENARIOS,
  WIDGET_SDK_RESOURCE_WIRE_VECTORS,
  WIDGET_SDK_SERVER_MODULE_VECTOR,
  WIDGET_SDK_SQL_PROFILE_VECTORS,
  WIDGET_SDK_CONFORMANCE_FIXTURE,
  WIDGET_SDK_CONFORMANCE_TRANSCRIPT,
  WIDGET_SDK_CONFORMANCE_VECTORS,
  fnCreateWidgetSdkConformanceServerModuleArtifact,
  fnRunWidgetSdkArtifactAdmissionConformance,
  fnRunWidgetSdkFunctionConformance,
  fnRunWidgetSdkModuleAdmissionConformance,
  fnRunWidgetSdkResourceProviderConformance,
  fnRunWidgetSdkResourceConformance,
  fnRunWidgetSdkSqlProfileConformance,
} from '../src/conformance';
import {
  PortableResourceWireError,
  WidgetManifestValidator,
  fnCanonicalizeWidgetExecutableProjection,
  fnCanonicalizeWidgetManifestV1,
  fnClassifyPortableResourceSql,
  fnDecodePortableResourceDbRows,
  fnDecodePortableResourceRequest,
  fnEncodePortableResourceFailure,
  fnEncodePortableResourceResult,
  fnEncodePortableResourceValue,
  fnProjectWidgetExecutableManifest,
  fnValidatePortableResourceSql,
  fnValidateWidgetServerModuleArtifact,
  fnWidgetServerModulePolicyAdmission,
} from '../src/contract';

const sha256 = (value: string | Uint8Array): string => (
  createHash('sha256').update(value).digest('hex')
);

describe('@omnidraw/sdk/conformance', () => {
  test('ships deterministic framework-neutral manifest and transcript vectors', () => {
    const manifest = WidgetManifestValidator.parse(WIDGET_SDK_CONFORMANCE_FIXTURE.manifest);
    expect(fnCanonicalizeWidgetManifestV1(manifest)).toBe(
      WIDGET_SDK_CONFORMANCE_VECTORS.find(({ name }) => name === 'canonical-manifest')?.expected,
    );
    expect(fnCanonicalizeWidgetExecutableProjection(
      fnProjectWidgetExecutableManifest(manifest),
    )).toBe(
      WIDGET_SDK_CONFORMANCE_VECTORS.find(({ name }) => name === 'canonical-executable-manifest')?.expected,
    );
    expect(WIDGET_SDK_CONFORMANCE_TRANSCRIPT.state.map(({ version }) => version)).toEqual([1, 2]);
    expect(WIDGET_SDK_CONFORMANCE_FIXTURE.files[0]?.text).not.toMatch(/react|three|capsule/i);
  });

  test('strict validators are library-neutral and reject unknown manifest authority', () => {
    const result = WidgetManifestValidator.safeParse({
      ...WIDGET_SDK_CONFORMANCE_FIXTURE.manifest,
      databaseUrl: 'file:ambient.db',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.name).toBe('SdkValidationError');
      expect(result.error.issues[0]?.code).toBe('unknown_key');
    }
  });

  test('pins the complete versioned portability inventory', () => {
    expect(WIDGET_SDK_MODULE_ADMISSION_VECTORS.map(({ name }) => name)).toEqual([
      'authored-sdk-import',
      'closed-module',
      'typescript-erased-types',
      'adapter-module',
      'commonjs-loader',
      'dynamic-code',
      'dynamic-code-computed-constructor',
      'dynamic-code-concatenated-constructor',
      'dynamic-code-escaped-constructor',
      'dynamic-code-escaped-identifier-constructor',
      'dynamic-code-aliased-constructor',
      'dynamic-code-destructured-constructor',
      'dynamic-import',
      'environment',
      'environment-escaped-process',
      'filesystem',
      'filesystem-comment-obfuscated-import',
      'filesystem-escaped-specifier',
      'import-attributes',
      'module-loader',
      'native-addon',
      'network',
      'os',
      'process',
      'shared-memory',
      'socket',
      'socket-module',
      'dns-module',
      'static-import',
      'static-import-compact',
      'subprocess',
      'timer',
      'timer-template-expression',
      'webassembly',
      'worker-global',
      'worker-global-node-buffer',
      'worker-global-node-global',
      'worker-global-computed-self',
      'worker-global-closed-fetch',
      'worker-global-closed-crypto',
      'worker-global-closed-dynamic-property',
    ]);
    expect(WIDGET_SDK_ARTIFACT_ADMISSION_VECTORS.map(({ name }) => name)).toEqual([
      'canonical-artifact',
      'module-byte-drift',
      'descriptor-digest-drift',
      'contract-drift',
    ]);
    expect(WIDGET_SDK_RESOURCE_WIRE_VECTORS.map(({ name }) => name)).toEqual([
      'tagged-value',
      'database-row-codec-all-cell-types',
      'database-json-cell-bigint-rejected',
      'database-json-cell-bytes-rejected',
      'database-json-cell-nested-bytes-rejected',
      'malformed-request',
    ]);
    expect(WIDGET_SDK_SQL_PROFILE_VECTORS.map(({ name }) => name)).toEqual([
      'select',
      'cte-write',
      'transaction',
      'attachment',
      'pragma',
      'vacuum',
      'extension',
      'host-file',
      'temp-object',
      'trigger',
      'internal-write',
      'multiple-statements',
      'effect-mismatch',
    ]);
    expect(WIDGET_SDK_FUNCTION_SCENARIOS.map(({ name }) => name)).toEqual([
      'fn-success',
      'fx-read',
      'tx-write',
      'invalid-input',
      'invalid-output',
      'undeclared-slot',
      'effect-escalation',
      'handler-failure',
      'timeout',
      'cancellation',
      'output-limit',
      'log-success',
      'log-limit',
      'runtime-dynamic-code',
      'resource-call-limit',
      'ambiguous-write',
    ]);
    expect(WIDGET_SDK_RESOURCE_PROVIDER_SCENARIOS.map(({ name, steps }) => (
      [name, steps.map(({ name: stepName }) => stepName)]
    ))).toEqual([
      ['kv-all-operations-and-conflict', [
        'set', 'get', 'has', 'list', 'compare-and-set-conflict', 'compare-and-set', 'delete',
      ]],
      ['kv-limit', ['list-limit']],
      ['secret-store-all-operations-and-conflict', [
        'set', 'get', 'has', 'list', 'compare-and-set-conflict', 'compare-and-set', 'delete',
      ]],
      ['secret-store-limit', ['list-limit']],
      ['db-operations-sql-cells-and-json-parameter', [
        'single-execute-create',
        'single-execute-insert',
        'query-bigint-blob-null-and-json-text',
        'named-invoke',
        'named-json-parameter',
        'single-execute-update',
        'execute-batch',
        'rejected-sql',
      ]],
      ['db-named-json-and-nullability', [
        'json-string',
        'json-number',
        'json-boolean',
        'json-array',
        'json-null',
        'all-types-nullable',
        'string-null-rejected',
        'number-null-rejected',
        'boolean-null-rejected',
        'bigint-null-rejected',
        'bytes-null-rejected',
        'json-null-rejected',
        'bigint-as-json-rejected',
        'bytes-as-json-rejected',
      ]],
      ['db-result-limit', ['create-limit-table', 'fill-limit-table', 'row-limit']],
    ]);
    expect(WIDGET_SDK_RESOURCE_PROVIDER_SCENARIOS.reduce(
      (count, scenario) => count + scenario.steps.length,
      0,
    )).toBe(41);
  });

  test('pins one canonical raw module and path-free fn/fx/tx descriptors', () => {
    const artifact = fnCreateWidgetSdkConformanceServerModuleArtifact();
    expect(artifact.moduleBytes.byteLength).toBe(WIDGET_SDK_SERVER_MODULE_VECTOR.moduleBytes.length);
    expect(sha256(artifact.moduleBytes)).toBe(WIDGET_SDK_SERVER_MODULE_VECTOR.moduleDigestSha256);
    expect(sha256(WIDGET_SDK_SERVER_MODULE_VECTOR.functionDescriptorsCanonicalJson)).toBe(
      WIDGET_SDK_SERVER_MODULE_VECTOR.functionDescriptorsDigestSha256,
    );
    expect(new TextDecoder().decode(Uint8Array.from(
      WIDGET_SDK_SERVER_MODULE_VECTOR.functionDescriptorsBytes,
    ))).toBe(WIDGET_SDK_SERVER_MODULE_VECTOR.functionDescriptorsCanonicalJson);
    expect(sha256(WIDGET_SDK_SERVER_MODULE_VECTOR.artifactIdentityCanonicalJson)).toBe(
      WIDGET_SDK_SERVER_MODULE_VECTOR.artifactDigestSha256,
    );
    expect(fnCanonicalizeWidgetManifestV1(WIDGET_SDK_SERVER_MODULE_VECTOR.manifest)).toBe(
      WIDGET_SDK_SERVER_MODULE_VECTOR.canonicalManifestJson,
    );
    expect(fnValidateWidgetServerModuleArtifact({ artifact, digestSha256: sha256 }))
      .toEqual({ valid: true });
    expect(new Set(artifact.functionDescriptors.map(({ effect }) => effect)))
      .toEqual(new Set(['fn', 'fx', 'tx']));
    expect(artifact.functionDescriptors).toHaveLength(16);
    expect(JSON.stringify(artifact.functionDescriptors)).not.toContain('modulePath');
    const second = fnCreateWidgetSdkConformanceServerModuleArtifact();
    expect(second.moduleBytes).not.toBe(artifact.moduleBytes);
    artifact.moduleBytes[0] = 0;
    expect(second.moduleBytes[0]).not.toBe(0);
  });

  test('ships canonical tagged values, database rows, and malformed-wire codes', () => {
    for (const vector of WIDGET_SDK_RESOURCE_WIRE_VECTORS) {
      if (vector.operation === 'encode_value') {
        expect(fnEncodePortableResourceValue(vector.input), vector.name).toEqual(vector.expected);
      } else if (vector.operation === 'decode_db_rows') {
        expect(fnDecodePortableResourceDbRows(vector.input), vector.name).toEqual(vector.expected);
      } else if (vector.operation === 'decode_db_rows_error') {
        try {
          fnDecodePortableResourceDbRows(vector.input);
          throw new Error(`Expected '${vector.name}' to fail.`);
        } catch (error) {
          expect(error).toBeInstanceOf(PortableResourceWireError);
          expect((error as PortableResourceWireError).code).toBe(vector.expectedErrorCode);
        }
      } else {
        try {
          fnDecodePortableResourceRequest(vector.input);
          throw new Error(`Expected '${vector.name}' to fail.`);
        } catch (error) {
          expect(error).toBeInstanceOf(PortableResourceWireError);
          expect((error as PortableResourceWireError).code).toBe(vector.expectedErrorCode);
        }
      }
    }
  });

  test('runs admission and SQL vectors through fresh disposable adapters', async () => {
    let artifactDisposed = 0;
    const artifacts = await fnRunWidgetSdkArtifactAdmissionConformance(() => ({
      admit: (artifact) => fnValidateWidgetServerModuleArtifact({ artifact, digestSha256: sha256 }),
      dispose: () => { artifactDisposed += 1; },
    }));
    expect(artifacts).toHaveLength(WIDGET_SDK_ARTIFACT_ADMISSION_VECTORS.length);
    expect(artifactDisposed).toBe(WIDGET_SDK_ARTIFACT_ADMISSION_VECTORS.length);

    let admissionCreated = 0;
    let admissionDisposed = 0;
    const admission = await fnRunWidgetSdkModuleAdmissionConformance(() => {
      admissionCreated += 1;
      return {
        admit: fnWidgetServerModulePolicyAdmission,
        dispose: () => { admissionDisposed += 1; },
      };
    });
    expect(admission).toHaveLength(WIDGET_SDK_MODULE_ADMISSION_VECTORS.length);
    expect(admissionCreated).toBe(WIDGET_SDK_MODULE_ADMISSION_VECTORS.length);
    expect(admissionDisposed).toBe(admissionCreated);

    let sqlDisposed = 0;
    const sql = await fnRunWidgetSdkSqlProfileConformance(() => ({
      classify: ({ sql: statement, expectedEffect }) => expectedEffect === undefined
        ? fnClassifyPortableResourceSql(statement)
        : fnValidatePortableResourceSql({ sql: statement, expectedEffect }),
      dispose: () => { sqlDisposed += 1; },
    }));
    expect(sql).toHaveLength(WIDGET_SDK_SQL_PROFILE_VECTORS.length);
    expect(sqlDisposed).toBe(WIDGET_SDK_SQL_PROFILE_VECTORS.length);
  });

  test('runs canonical resource transcripts without exposing provider authority', async () => {
    let disposed = 0;
    const transcript = await fnRunWidgetSdkResourceConformance((scenario) => ({
      async route(requestWire) {
        try {
          const request = fnDecodePortableResourceRequest(requestWire);
          const entry = scenario.seed.find(({ key }) => (
            key === (request.input as { key?: unknown }).key
          ));
          return fnEncodePortableResourceResult({
            correlationId: request.correlationId,
            output: entry === undefined
              ? null
              : { value: entry.value, revision: 1 },
          });
        } catch {
          return fnEncodePortableResourceFailure({
            correlationId: 'resource-malformed',
            failure: {
              code: 'RESOURCE_MALFORMED_INPUT',
              message: 'Resource request is malformed.',
            },
          });
        }
      },
      dispose: () => { disposed += 1; },
    }));
    expect(transcript).toEqual(WIDGET_SDK_RESOURCE_SCENARIOS.map(({ expected }) => expected));
    expect(disposed).toBe(WIDGET_SDK_RESOURCE_SCENARIOS.length);
  });

  test('runs complete provider families sequentially with one fresh disposable port each', async () => {
    let disposed = 0;
    const transcript = await fnRunWidgetSdkResourceProviderConformance((scenario) => {
      let index = 0;
      return {
        call: () => scenario.steps[index++]!.expected,
        dispose: () => { disposed += 1; },
      };
    });
    expect(transcript).toHaveLength(WIDGET_SDK_RESOURCE_PROVIDER_SCENARIOS.reduce(
      (count, scenario) => count + scenario.steps.length,
      0,
    ));
    expect(disposed).toBe(WIDGET_SDK_RESOURCE_PROVIDER_SCENARIOS.length);
    expect(new Set(WIDGET_SDK_RESOURCE_PROVIDER_SCENARIOS.map(({ kind }) => kind)))
      .toEqual(new Set(['kv', 'secretStore', 'db']));
  });

  test('runs function outcomes through a narrow disposable port and fails on drift', async () => {
    let disposed = 0;
    const transcript = await fnRunWidgetSdkFunctionConformance((scenario) => ({
      invoke: ({ serverModule, functionName }) => {
        expect(serverModule.moduleDigestSha256).toBe(
          WIDGET_SDK_SERVER_MODULE_VECTOR.moduleDigestSha256,
        );
        expect(functionName).toBe(scenario.functionName);
        return scenario.expected;
      },
      dispose: () => { disposed += 1; },
    }));
    expect(transcript).toEqual(WIDGET_SDK_FUNCTION_SCENARIOS.map(({ expected }) => expected));
    expect(disposed).toBe(WIDGET_SDK_FUNCTION_SCENARIOS.length);

    let driftDisposed = false;
    await expect(fnRunWidgetSdkFunctionConformance(() => ({
      invoke: () => ({ status: 'failed', code: 'WRONG_CODE' }),
      dispose: () => { driftDisposed = true; },
    }))).rejects.toThrow(/diverged/);
    expect(driftDisposed).toBe(true);
  });
});
