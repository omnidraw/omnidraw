import type {
  CapsuleCapabilityGrant,
  CapsuleHash,
} from '@vibecanvas/capsule-vibecanvas/contract';
import type {
  TWidgetCapsuleCapabilityRequest,
  TWidgetCapsuleRuntimeDescriptor,
} from '@vibecanvas/widget-contract';
import type {
  TWidgetCapsuleCapabilityCatalogEntry,
  TWidgetCapsuleHostCatalog,
  TWidgetCapsuleMountCatalog,
} from './interface';
import { fnWidgetCapsuleRuntimeApis } from './fn.capsule-runtime-apis';

export type TResolvedWidgetCapsuleCapability = Readonly<{
  request: TWidgetCapsuleCapabilityRequest;
  catalogEntry: TWidgetCapsuleCapabilityCatalogEntry;
  grant: CapsuleCapabilityGrant;
}>;

const KEY_ID_PATTERN = /^[A-Za-z0-9._~:+-]{1,170}$/;

function apisAllowed(
  catalog: TWidgetCapsuleHostCatalog,
  requested: readonly string[],
): boolean {
  const allowed = new Set<string>(catalog.allowedApis);
  return requested.length > 0
    && requested.every((api) => allowed.has(api));
}

export function fnValidateWidgetCapsuleHostCatalog(
  catalog: TWidgetCapsuleHostCatalog,
): void {
  if (!KEY_ID_PATTERN.test(catalog.generation)) {
    throw new TypeError('Widget Capsule catalog generation is invalid.');
  }
  if (
    !KEY_ID_PATTERN.test(catalog.previewSigningKeyId)
    || !KEY_ID_PATTERN.test(catalog.releaseSigningKeyId)
    || catalog.trustedSigningKeys.size < 1
    || !catalog.trustedSigningKeys.has(catalog.previewSigningKeyId)
    || !catalog.trustedSigningKeys.has(catalog.releaseSigningKeyId)
  ) {
    throw new TypeError('Widget Capsule signing-key catalog is invalid.');
  }
  if (catalog.allowedApis.length < 1 || catalog.allowedApis.length > 10) {
    throw new TypeError('Widget Capsule API policy is invalid.');
  }
  const apis = new Set<string>();
  for (const api of catalog.allowedApis) {
    if (apis.has(api)) {
      throw new TypeError('Widget Capsule API policy is invalid.');
    }
    apis.add(api);
  }
  if (!apis.has('DOM')) throw new TypeError('Widget Capsule API policy must allow DOM.');

  const dimensions = Object.keys(catalog.limits) as Array<
    keyof TWidgetCapsuleHostCatalog['limits']
  >;
  for (const dimension of dimensions) {
    const ceiling = catalog.limits[dimension];
    if (
      typeof ceiling !== 'number'
      || !Number.isFinite(ceiling)
      || ceiling < 0
      || (dimension !== 'cpuMs' && !Number.isSafeInteger(ceiling))
    ) {
      throw new TypeError('Widget Capsule limit catalog is invalid.');
    }
  }
}

export function fnValidateWidgetCapsuleMountCatalog(
  catalog: TWidgetCapsuleMountCatalog,
): void {
  fnValidateWidgetCapsuleHostCatalog(catalog);
  const schemaHashes = new Set<CapsuleHash>();
  for (const schema of catalog.schemas) {
    if (schemaHashes.has(schema.reference.hash)) {
      throw new TypeError('Widget Capsule catalog contains a duplicate schema.');
    }
    schemaHashes.add(schema.reference.hash);
  }

  const capabilityIds = new Set<string>();
  for (const entry of catalog.capabilities) {
    const descriptor = entry.descriptor;
    if (capabilityIds.has(descriptor.id)) {
      throw new TypeError('Widget Capsule catalog capability IDs must be unique.');
    }
    capabilityIds.add(descriptor.id);
    const operations = new Set<string>();
    for (const operation of descriptor.operations) {
      if (operations.has(operation.name)) {
        throw new TypeError('Widget Capsule catalog contains a duplicate operation.');
      }
      operations.add(operation.name);
      if (!schemaHashes.has(operation.inputSchema.hash)) {
        throw new TypeError('Widget Capsule capability input schema is not registered.');
      }
      if (
        operation.outputSchema !== undefined
        && !schemaHashes.has(operation.outputSchema.hash)
      ) {
        throw new TypeError('Widget Capsule capability output schema is not registered.');
      }
      if (
        operation.eventSchema !== undefined
        && !schemaHashes.has(operation.eventSchema.hash)
      ) {
        throw new TypeError('Widget Capsule capability event schema is not registered.');
      }
    }
  }
}

export function fnAssertWidgetCapsuleRuntimeCompatible(
  catalog: TWidgetCapsuleHostCatalog,
  descriptor: TWidgetCapsuleRuntimeDescriptor,
  mode: 'preview' | 'published',
): void {
  if (!apisAllowed(catalog, fnWidgetCapsuleRuntimeApis(descriptor))) {
    throw new Error('Widget Capsule API request is outside the shared host catalog.');
  }
  const dimensions = Object.keys(catalog.limits) as Array<
    keyof TWidgetCapsuleHostCatalog['limits']
  >;
  for (const dimension of dimensions) {
    const value = descriptor.budgets[dimension];
    if (
      value !== undefined
      && (
        typeof value !== 'number'
        || !Number.isFinite(value)
        || value < 0
        || (dimension !== 'cpuMs' && !Number.isSafeInteger(value))
        || value > catalog.limits[dimension]!
      )
    ) {
      throw new Error('Widget Capsule budgets exceed the shared host limits.');
    }
  }
  const expectedKeyId = mode === 'preview'
    ? catalog.previewSigningKeyId
    : catalog.releaseSigningKeyId;
  if (
    descriptor.signatureKeyIds.length !== 1
    || descriptor.signatureKeyIds[0] !== expectedKeyId
  ) {
    throw new Error('Widget Capsule artifact uses the wrong signing authority.');
  }
  if (descriptor.parkability.parkable !== false) {
    throw new Error('Widget Capsule parking is not enabled for this release.');
  }
}

export function fnResolveWidgetCapsuleCapabilities(
  catalog: TWidgetCapsuleMountCatalog,
  requests: readonly TWidgetCapsuleCapabilityRequest[],
): readonly TResolvedWidgetCapsuleCapability[] {
  const entries = new Map(catalog.capabilities.map((entry) => [
    entry.descriptor.id,
    entry,
  ]));
  const seen = new Set<string>();
  return requests.map((request) => {
    if (seen.has(request.id)) {
      throw new Error('Widget Capsule artifact contains a duplicate capability request.');
    }
    seen.add(request.id);
    const catalogEntry = entries.get(request.id);
    if (catalogEntry === undefined) {
      throw new Error(`Widget Capsule capability "${request.id}" is not in the host catalog.`);
    }
    const descriptor = catalogEntry.descriptor;
    if (
      descriptor.contractHash !== request.contractHash
      || descriptor.version !== request.versionRange
    ) {
      throw new Error(`Widget Capsule capability "${request.id}" does not match the host catalog.`);
    }
    const descriptorOperations = new Set(descriptor.operations.map((operation) => operation.name));
    if (
      request.operations.length < 1
      || request.operations.some((operation) => !descriptorOperations.has(operation))
    ) {
      throw new Error(`Widget Capsule capability "${request.id}" requests unknown operations.`);
    }
    return Object.freeze({
      request,
      catalogEntry,
      grant: Object.freeze({
        id: descriptor.id,
        version: descriptor.version,
        contractHash: descriptor.contractHash,
        operations: Object.freeze([...request.operations]),
      }),
    });
  });
}
