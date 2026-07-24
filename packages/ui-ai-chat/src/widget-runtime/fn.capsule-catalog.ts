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

export type TResolvedWidgetCapsuleCapability = Readonly<{
  request: TWidgetCapsuleCapabilityRequest;
  catalogEntry: TWidgetCapsuleCapabilityCatalogEntry;
  grant: CapsuleCapabilityGrant;
}>;

const KEY_ID_PATTERN = /^[A-Za-z0-9._~:+-]{1,170}$/;

function targetsEqual(
  catalog: TWidgetCapsuleHostCatalog,
  right: TWidgetCapsuleRuntimeDescriptor['target'],
): boolean {
  const profiles = new Set(right.featureProfiles);
  const allowed = new Set(catalog.allowedFeatureProfiles);
  return catalog.targetBase.runtimeAbi === right.runtimeAbi
    && catalog.targetBase.domProfile === right.domProfile
    && profiles.size === right.featureProfiles.length
    && right.featureProfiles.every((profile) => allowed.has(profile));
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
  if (
    catalog.targetBase.runtimeAbi.length < 1
    || catalog.targetBase.domProfile.length < 1
    || catalog.allowedFeatureProfiles.length > 64
  ) {
    throw new TypeError('Widget Capsule target policy is invalid.');
  }
  const featureProfiles = new Set<string>();
  for (const profile of catalog.allowedFeatureProfiles) {
    if (profile.length < 1 || featureProfiles.has(profile)) {
      throw new TypeError('Widget Capsule feature-profile policy is invalid.');
    }
    featureProfiles.add(profile);
  }

  const dimensions = Object.keys(catalog.budgetCeiling) as Array<
    keyof TWidgetCapsuleHostCatalog['budgetCeiling']
  >;
  for (const dimension of dimensions) {
    const ceiling = catalog.budgetCeiling[dimension];
    const defaultValue = catalog.budgetDefaults[dimension];
    if (
      typeof ceiling !== 'number'
      || !Number.isFinite(ceiling)
      || ceiling < 0
      || (dimension !== 'cpuMs' && !Number.isSafeInteger(ceiling))
      || typeof defaultValue !== 'number'
      || !Number.isFinite(defaultValue)
      || defaultValue < 0
      || (dimension !== 'cpuMs' && !Number.isSafeInteger(defaultValue))
      || defaultValue > ceiling
    ) {
      throw new TypeError('Widget Capsule budget catalog is invalid.');
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
  if (!targetsEqual(catalog, descriptor.target)) {
    throw new Error('Widget Capsule execution target is outside the shared host catalog.');
  }
  const dimensions = Object.keys(catalog.budgetCeiling) as Array<
    keyof TWidgetCapsuleHostCatalog['budgetCeiling']
  >;
  for (const dimension of dimensions) {
    const value = descriptor.budgets[dimension];
    if (
      typeof value !== 'number'
      || !Number.isFinite(value)
      || value < 0
      || (dimension !== 'cpuMs' && !Number.isSafeInteger(value))
      || value > catalog.budgetCeiling[dimension]
    ) {
      throw new Error('Widget Capsule budgets exceed the shared host catalog.');
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
