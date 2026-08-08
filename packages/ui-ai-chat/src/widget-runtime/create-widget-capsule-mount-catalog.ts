import type {
  TOmnidrawCapsuleCapabilityContract,
} from '@omnidraw/capsule-omnidraw/capabilities';
import {
  createOmnidrawCollaborativeStateCapabilityContract,
  createOmnidrawGuestChannelContract,
  createOmnidrawServerFunctionCapabilityContract,
  OMNIDRAW_COLLABORATIVE_STATE_CAPABILITY_ID,
} from '@omnidraw/capsule-omnidraw/capabilities';
import {
  ZWidgetBrowserFunctionDescriptors,
  fnCanonicalizeWidgetBrowserFunctionDescriptors,
  fnWidgetBrowserFunctionCapabilityRequestMatches,
  type TWidgetBrowserFunctionDescriptor,
  type TWidgetCapsuleCapabilityRequest,
} from '@omnidraw/widget-contract';
import type {
  TWidgetCapsuleHostCatalog,
  TWidgetCapsuleMountCatalog,
  TWidgetUiArtifactMountPort,
} from './interface';

const SHA256_PATTERN = /^[0-9a-f]{64}$/;

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'undefined';
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  const record = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(record).sort().map((key) => (
    `${JSON.stringify(key)}:${canonicalJson(record[key])}`
  )).join(',')}}`;
}

function requestsMatch(
  derived: TOmnidrawCapsuleCapabilityContract['request'],
  signed: TWidgetCapsuleCapabilityRequest,
): boolean {
  return canonicalJson({
    ...derived,
    operations: [...derived.operations].sort(),
  }) === canonicalJson({
    ...signed,
    operations: [...signed.operations].sort(),
  });
}

function assertDerivedRequest(
  contract: TOmnidrawCapsuleCapabilityContract,
  request: TWidgetCapsuleCapabilityRequest,
): void {
  if (!requestsMatch(contract.request, request)) {
    throw new Error(
      `Widget Capsule capability "${request.id}" is inconsistent with its derived contract.`,
    );
  }
}

function functionDescriptorDigest(
  request: TWidgetCapsuleCapabilityRequest,
): string {
  const match = /^sha256:([0-9a-f]{64})$/.exec(request.contractHash);
  if (match === null) {
    throw new Error('Widget server-function contract hash is invalid.');
  }
  return match[1]!;
}

function deduplicateSchemas(
  contracts: readonly Readonly<{
    schemas: TOmnidrawCapsuleCapabilityContract['schemas'];
  }>[],
) {
  const schemas = new Map<string, TOmnidrawCapsuleCapabilityContract['schemas'][number]>();
  for (const contract of contracts) {
    for (const schema of contract.schemas) {
      schemas.set(schema.reference.hash, schema);
    }
  }
  return Object.freeze([...schemas.values()].sort((left, right) => (
    left.reference.hash < right.reference.hash ? -1 : 1
  )));
}

export async function createWidgetCapsuleMountCatalog(
  base: TWidgetCapsuleHostCatalog,
  args: Parameters<TWidgetUiArtifactMountPort['mount']>[0],
): Promise<TWidgetCapsuleMountCatalog> {
  const requests = args.artifact.runtimeDescriptor.capabilityRequests;
  const collaborativeRequest = requests.find(
    (request) => request.id === OMNIDRAW_COLLABORATIVE_STATE_CAPABILITY_ID,
  );
  const functionRequests = requests.filter(
    (request) => request.id !== OMNIDRAW_COLLABORATIVE_STATE_CAPABILITY_ID,
  );
  if (
    functionRequests.length !== (args.functionDescriptors.length === 0 ? 0 : 1)
  ) {
    throw new Error('Widget server-function metadata does not match signed capability requests.');
  }

  const signedFunctionRequest = functionRequests.length === 0
    ? null
    : functionRequests[0]!;
  if (
    signedFunctionRequest !== null
    && !fnWidgetBrowserFunctionCapabilityRequestMatches(
      signedFunctionRequest,
      args.functionDescriptors,
    )
  ) {
    throw new Error(
      'Widget browser function descriptors do not match the signed capability request.',
    );
  }
  const functionContract = signedFunctionRequest === null
    ? null
    : await createOmnidrawServerFunctionCapabilityContract({
        descriptorDigestSha256: functionDescriptorDigest(signedFunctionRequest),
        functions: args.functionDescriptors,
      });
  if (functionContract !== null) {
    assertDerivedRequest(functionContract, functionRequests[0]!);
  }

  const collaborativeContract = collaborativeRequest === undefined
    ? null
    : await createOmnidrawCollaborativeStateCapabilityContract();
  if (collaborativeContract !== null) {
    assertDerivedRequest(collaborativeContract, collaborativeRequest!);
  }

  const channels = args.artifact.runtimeDescriptor.channels === null
    ? null
    : await createOmnidrawGuestChannelContract({
        localStore: args.artifact.runtimeDescriptor.channels.store === undefined
          ? 'none'
          : 'ephemeral',
      });
  if (
    channels !== null
    && canonicalJson(channels.declaration)
      !== canonicalJson(args.artifact.runtimeDescriptor.channels)
  ) {
    throw new Error('Widget Capsule channels are inconsistent with the host contract.');
  }

  const capabilityContracts = [functionContract, collaborativeContract].filter(
    (contract): contract is TOmnidrawCapsuleCapabilityContract => contract !== null,
  );
  return Object.freeze({
    ...base,
    schemas: deduplicateSchemas([
      ...capabilityContracts,
      ...(channels === null ? [] : [channels]),
    ]),
    capabilities: Object.freeze(capabilityContracts.map((contract) => Object.freeze({
      kind: contract === functionContract
        ? 'server-functions' as const
        : 'collaborative-state' as const,
      descriptor: contract.descriptor,
    }))),
  });
}

export async function verifyWidgetBrowserFunctionDescriptors(
  digestSha256: (bytes: Uint8Array) => Promise<string>,
  expectedDigestSha256: string,
  descriptors: readonly TWidgetBrowserFunctionDescriptor[],
): Promise<readonly TWidgetBrowserFunctionDescriptor[]> {
  if (!SHA256_PATTERN.test(expectedDigestSha256)) {
    throw new Error('Widget browser function descriptor digest is invalid.');
  }
  const normalized = ZWidgetBrowserFunctionDescriptors.parse(descriptors);
  const actualDigestSha256 = await digestSha256(new TextEncoder().encode(
    fnCanonicalizeWidgetBrowserFunctionDescriptors(normalized),
  ));
  if (
    !SHA256_PATTERN.test(actualDigestSha256)
    || actualDigestSha256 !== expectedDigestSha256
  ) {
    throw new Error('Widget browser function descriptors failed integrity verification.');
  }
  return normalized;
}
