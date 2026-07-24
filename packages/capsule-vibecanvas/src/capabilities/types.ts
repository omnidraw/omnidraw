import type {
  CapsuleCapabilityDescriptor,
  CapsuleCapabilityGrant,
  CapsuleCapabilityRequest,
  CapsuleSchemaReference,
} from '@omnidraw/capsule/protocol';
import type { CapsuleSchemaResource } from '@omnidraw/capsule/schema';

export type TVibecanvasCapsuleCapabilitySelector = Readonly<{
  id: string;
  versionRange: string;
  contractHash: `sha256:${string}`;
}>;

export type TVibecanvasCapsuleCapabilityContract = Readonly<{
  descriptor: CapsuleCapabilityDescriptor;
  request: CapsuleCapabilityRequest;
  grant: CapsuleCapabilityGrant;
  selector: TVibecanvasCapsuleCapabilitySelector;
  schemas: readonly CapsuleSchemaResource[];
}>;

export type TVibecanvasCapsuleChannelContract = Readonly<{
  declaration: Readonly<{
    format: 'capsule-guest-channels-v1';
    lifecycle: true;
    props: CapsuleSchemaReference;
    theme: CapsuleSchemaReference;
    output: CapsuleSchemaReference;
    store?: Readonly<{
      schema: CapsuleSchemaReference;
      maxEntries: number;
    }>;
  }>;
  schemas: readonly CapsuleSchemaResource[];
}>;
