/** @file Local one-child direct-function runtime adapters. */

export {
  BunChildFunctionDescriptorExtractor,
  type TBunChildFunctionDescriptorExtractorConfig,
} from './BunChildFunctionDescriptorExtractor';
export {
  BunChildSandboxDriver,
  type TBunChildSandboxDiagnostics,
  type TBunChildSandboxDriverConfig,
} from './BunChildSandboxDriver';
export type { TBunChildProcessGroupController } from './BunChildLifecycle';
export {
  DirectFunctionExecutor,
  type TDirectFunctionExecutorConfig,
  type TDirectFunctionExecutorDiagnostics,
} from './DirectFunctionExecutor';
export {
  DirectInvocationResourceGateway,
  type TDirectInvocationResourceGatewayConfig,
} from './DirectInvocationResourceGateway';
export {
  JsonSchemaFunctionValidator,
  type IFunctionSchemaValidator,
  type TFunctionSchemaValidation,
  type TJsonSchemaFunctionValidatorConfig,
} from './JsonSchemaFunctionValidator';
export {
  EphemeralResourceWritePermitAuthority,
  type TEphemeralResourceWritePermitAuthorityConfig,
} from './EphemeralResourceWritePermitAuthority';
export { fnFunctionArtifactAdmission } from './fn.artifact-admission';
export {
  fnParseServerArtifactEnvelope,
  fnServerArtifactEntryOutput,
  type TServerArtifactEnvelope,
  type TServerArtifactOutput,
} from './fn.artifact-envelope';
export { fnCanonicalJson, type TCanonicalJsonLimits } from './fn.canonical-json';
export {
  fnFunctionResourceCallDecision,
  type TFunctionResourceAccess,
  type TFunctionResourceCallDecision,
} from './fn.resource-call-policy';
export { fnBunFunctionWorkerCommand } from './fn.sandbox-command';
export { runFunctionWorker } from './function-worker';
