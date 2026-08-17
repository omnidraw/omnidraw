import { createCapsuleSchemaResource } from '@omnidraw/capsule/schema';
import type { TWidgetServerFunctionDescriptor } from '../../contracts/types';
import {
  fnOmnidrawCapabilityGrant,
  fnOmnidrawCapabilityRequest,
  fnOmnidrawCollaborativeStateCapabilitySelector,
  fnOmnidrawCollaborativeStateDescriptor,
  fnOmnidrawServerFunctionCapabilitySelector,
  fnOmnidrawServerFunctionDescriptor,
} from './fn.capability';
import {
  fnJsonSchemaToCapsuleSchemaDocument,
  fnOmnidrawAnySchemaDocument,
  fnOmnidrawCollaborativeChangeSchemaDocument,
  fnOmnidrawCollaborativeSnapshotSchemaDocument,
  fnOmnidrawNullSchemaDocument,
} from './fn.json-schema';
import {
  fnOmnidrawWidgetOutputSchemaDocument,
  fnOmnidrawWidgetPropsSchemaDocument,
  fnOmnidrawWidgetThemeSchemaDocument,
} from './fn.channel-schemas';
import type {
  TOmnidrawCapsuleCapabilityContract,
  TOmnidrawCapsuleChannelContract,
} from './types';

function deduplicateSchemas<T extends Readonly<{ reference: Readonly<{ hash: string }> }>>(
  values: readonly T[],
): readonly T[] {
  const byHash = new Map<string, T>();
  for (const value of values) byHash.set(value.reference.hash, value);
  return Object.freeze([...byHash.values()].sort((left, right) => (
    left.reference.hash < right.reference.hash ? -1 : 1
  )));
}

export async function createOmnidrawServerFunctionCapabilityContract(args: Readonly<{
  descriptorDigestSha256: string;
  functions: readonly TWidgetServerFunctionDescriptor[];
}>): Promise<TOmnidrawCapsuleCapabilityContract | null> {
  if (args.functions.length === 0) return null;
  const functions = await Promise.all(args.functions.map(async (item) => {
    const [input, output] = await Promise.all([
      createCapsuleSchemaResource(fnJsonSchemaToCapsuleSchemaDocument(item.inputSchema)),
      createCapsuleSchemaResource(fnJsonSchemaToCapsuleSchemaDocument(item.outputSchema)),
    ]);
    return Object.freeze({ function: item, inputSchema: input.reference, outputSchema: output.reference, input, output });
  }));
  const descriptor = fnOmnidrawServerFunctionDescriptor({
    descriptorDigestSha256: args.descriptorDigestSha256,
    functions,
  });
  const selector = fnOmnidrawServerFunctionCapabilitySelector(
    args.descriptorDigestSha256,
  );
  const operations = args.functions.map((item) => item.exportName);
  return Object.freeze({
    descriptor,
    selector,
    request: fnOmnidrawCapabilityRequest(selector, operations),
    grant: fnOmnidrawCapabilityGrant(selector, operations),
    schemas: deduplicateSchemas(functions.flatMap((item) => [item.input, item.output])),
  });
}

export async function createOmnidrawCollaborativeStateCapabilityContract():
Promise<TOmnidrawCapsuleCapabilityContract> {
  const [nullSchema, changeSchema, snapshotSchema] = await Promise.all([
    createCapsuleSchemaResource(fnOmnidrawNullSchemaDocument()),
    createCapsuleSchemaResource(fnOmnidrawCollaborativeChangeSchemaDocument()),
    createCapsuleSchemaResource(fnOmnidrawCollaborativeSnapshotSchemaDocument()),
  ]);
  const descriptor = fnOmnidrawCollaborativeStateDescriptor({
    nullSchema: nullSchema.reference,
    changeSchema: changeSchema.reference,
    snapshotSchema: snapshotSchema.reference,
  });
  const selector = fnOmnidrawCollaborativeStateCapabilitySelector();
  const operations = ['change', 'get', 'subscribe'];
  return Object.freeze({
    descriptor,
    selector,
    request: fnOmnidrawCapabilityRequest(selector, operations),
    grant: fnOmnidrawCapabilityGrant(selector, operations),
    schemas: deduplicateSchemas([nullSchema, changeSchema, snapshotSchema]),
  });
}

export async function createOmnidrawGuestChannelContract(args: Readonly<{
  localStore: 'none' | 'ephemeral';
}>): Promise<TOmnidrawCapsuleChannelContract> {
  const [props, theme, output, store] = await Promise.all([
    createCapsuleSchemaResource(fnOmnidrawWidgetPropsSchemaDocument()),
    createCapsuleSchemaResource(fnOmnidrawWidgetThemeSchemaDocument()),
    createCapsuleSchemaResource(fnOmnidrawWidgetOutputSchemaDocument()),
    args.localStore === 'none'
      ? Promise.resolve(null)
      : createCapsuleSchemaResource(fnOmnidrawAnySchemaDocument()),
  ]);
  return Object.freeze({
    declaration: Object.freeze({
      format: 'capsule-guest-channels-v1' as const,
      lifecycle: true as const,
      props: props.reference,
      theme: theme.reference,
      output: output.reference,
      ...(store === null
        ? {}
        : { store: Object.freeze({ schema: store.reference, maxEntries: 64 }) }),
    }),
    schemas: deduplicateSchemas([
      props,
      theme,
      output,
      ...(store === null ? [] : [store]),
    ]),
  });
}
