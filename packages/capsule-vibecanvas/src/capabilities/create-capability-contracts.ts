import { createCapsuleSchemaResource } from '@omnidraw/capsule/schema';
import type { TWidgetBrowserFunctionDescriptor } from '@vibecanvas/widget-contract';
import {
  fnVibecanvasCapabilityGrant,
  fnVibecanvasCapabilityRequest,
  fnVibecanvasCollaborativeStateCapabilitySelector,
  fnVibecanvasCollaborativeStateDescriptor,
  fnVibecanvasServerFunctionCapabilitySelector,
  fnVibecanvasServerFunctionDescriptor,
} from './fn.capability';
import {
  fnJsonSchemaToCapsuleSchemaDocument,
  fnVibecanvasAnySchemaDocument,
  fnVibecanvasCollaborativeChangeSchemaDocument,
  fnVibecanvasCollaborativeSnapshotSchemaDocument,
  fnVibecanvasNullSchemaDocument,
} from './fn.json-schema';
import {
  fnVibecanvasWidgetOutputSchemaDocument,
  fnVibecanvasWidgetPropsSchemaDocument,
  fnVibecanvasWidgetThemeSchemaDocument,
} from './fn.channel-schemas';
import type {
  TVibecanvasCapsuleCapabilityContract,
  TVibecanvasCapsuleChannelContract,
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

export async function createVibecanvasServerFunctionCapabilityContract(args: Readonly<{
  descriptorDigestSha256: string;
  functions: readonly TWidgetBrowserFunctionDescriptor[];
}>): Promise<TVibecanvasCapsuleCapabilityContract | null> {
  if (args.functions.length === 0) return null;
  const functions = await Promise.all(args.functions.map(async (item) => {
    const [input, output] = await Promise.all([
      createCapsuleSchemaResource(fnJsonSchemaToCapsuleSchemaDocument(item.inputSchema)),
      createCapsuleSchemaResource(fnJsonSchemaToCapsuleSchemaDocument(item.outputSchema)),
    ]);
    return Object.freeze({ function: item, inputSchema: input.reference, outputSchema: output.reference, input, output });
  }));
  const descriptor = fnVibecanvasServerFunctionDescriptor({
    descriptorDigestSha256: args.descriptorDigestSha256,
    functions,
  });
  const selector = fnVibecanvasServerFunctionCapabilitySelector(
    args.descriptorDigestSha256,
  );
  const operations = args.functions.map((item) => item.exportName);
  return Object.freeze({
    descriptor,
    selector,
    request: fnVibecanvasCapabilityRequest(selector, operations),
    grant: fnVibecanvasCapabilityGrant(selector, operations),
    schemas: deduplicateSchemas(functions.flatMap((item) => [item.input, item.output])),
  });
}

export async function createVibecanvasCollaborativeStateCapabilityContract():
Promise<TVibecanvasCapsuleCapabilityContract> {
  const [nullSchema, changeSchema, snapshotSchema] = await Promise.all([
    createCapsuleSchemaResource(fnVibecanvasNullSchemaDocument()),
    createCapsuleSchemaResource(fnVibecanvasCollaborativeChangeSchemaDocument()),
    createCapsuleSchemaResource(fnVibecanvasCollaborativeSnapshotSchemaDocument()),
  ]);
  const descriptor = fnVibecanvasCollaborativeStateDescriptor({
    nullSchema: nullSchema.reference,
    changeSchema: changeSchema.reference,
    snapshotSchema: snapshotSchema.reference,
  });
  const selector = fnVibecanvasCollaborativeStateCapabilitySelector();
  const operations = ['change', 'get', 'subscribe'];
  return Object.freeze({
    descriptor,
    selector,
    request: fnVibecanvasCapabilityRequest(selector, operations),
    grant: fnVibecanvasCapabilityGrant(selector, operations),
    schemas: deduplicateSchemas([nullSchema, changeSchema, snapshotSchema]),
  });
}

export async function createVibecanvasGuestChannelContract(args: Readonly<{
  localStore: 'none' | 'ephemeral';
}>): Promise<TVibecanvasCapsuleChannelContract> {
  const [props, theme, output, store] = await Promise.all([
    createCapsuleSchemaResource(fnVibecanvasWidgetPropsSchemaDocument()),
    createCapsuleSchemaResource(fnVibecanvasWidgetThemeSchemaDocument()),
    createCapsuleSchemaResource(fnVibecanvasWidgetOutputSchemaDocument()),
    args.localStore === 'none'
      ? Promise.resolve(null)
      : createCapsuleSchemaResource(fnVibecanvasAnySchemaDocument()),
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
