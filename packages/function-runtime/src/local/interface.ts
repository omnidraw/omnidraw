/** @file Local function executor adapter seams. */

import type { IResourceGateway } from '@vibecanvas/resource-runtime';
import type { TTenantContext } from '@vibecanvas/tenant-core';
import type {
  TFunctionAttempt,
  TFunctionDefinition,
  TFunctionInvocationEnvelope,
  TFunctionInvocationSubject,
  TInvocationLease,
} from '../types';

export interface IExactFunctionArtifactReader {
  readExactServerArtifact(
    tenant: TTenantContext,
    request: Readonly<{
      widgetDefinitionId: string;
      widgetRevisionId: string;
      artifactId: string;
      artifactDigestSha256: string;
      contractDigestSha256: string;
      runtimeAbi: string;
      subject: TFunctionInvocationSubject;
    }>,
  ): Promise<Uint8Array>;
}

export interface IInvocationResourceGatewayFactory {
  createInvocationResourceGateway(request: Readonly<{
    tenant: TTenantContext;
    definition: TFunctionDefinition;
    envelope: TFunctionInvocationEnvelope;
    attempt: TFunctionAttempt;
    getLease: () => TInvocationLease;
  }>): Promise<IResourceGateway> | IResourceGateway;
}
