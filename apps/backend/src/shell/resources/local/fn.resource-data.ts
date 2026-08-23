import type {
  TResourceJson,
  TResourceKeyValueEntryMetadata,
} from './ResourceKeyValuePersistence';

const VALUE_PREVIEW_MAX_LENGTH = 4_096;

export type TResourceKvDataEntry = {
  readonly key: string;
  readonly valuePreview: string;
  readonly valueTruncated: boolean;
  readonly revision: number;
  readonly createdAtSec: string;
  readonly updatedAtSec: string;
};

export type TResourceSecretDataEntry = {
  readonly name: string;
  readonly revision: number;
  readonly createdAtSec: string;
  readonly updatedAtSec: string;
};

export type TResourceDataPage =
  | { readonly kind: 'kv'; readonly entries: TResourceKvDataEntry[]; readonly nextCursor: string | null }
  | { readonly kind: 'secretStore'; readonly entries: TResourceSecretDataEntry[]; readonly nextCursor: string | null };

export type TResourceDataMutationResult =
  | { readonly kind: 'kv'; readonly entry: TResourceKvDataEntry }
  | { readonly kind: 'secretStore'; readonly entry: TResourceSecretDataEntry };

export function fnJsonValuePreview(value: TResourceJson): { preview: string; truncated: boolean } {
  const serialized = JSON.stringify(value) ?? 'null';
  if (serialized.length <= VALUE_PREVIEW_MAX_LENGTH) return { preview: serialized, truncated: false };
  return { preview: serialized.slice(0, VALUE_PREVIEW_MAX_LENGTH), truncated: true };
}

export function fnResourceDataPage(
  kind: 'kv' | 'secretStore',
  page: {
    entries: readonly (TResourceKeyValueEntryMetadata & { readonly value?: TResourceJson })[];
    nextCursor: string | null;
  },
): TResourceDataPage {
  if (kind === 'secretStore') {
    return {
      kind,
      entries: page.entries.map((entry) => ({
        name: entry.key,
        revision: entry.revision,
        createdAtSec: entry.createdAtSec,
        updatedAtSec: entry.updatedAtSec,
      })),
      nextCursor: page.nextCursor,
    };
  }
  return {
    kind,
    entries: page.entries.map((entry) => {
      const value = fnJsonValuePreview(entry.value ?? null);
      return {
        key: entry.key,
        valuePreview: value.preview,
        valueTruncated: value.truncated,
        revision: entry.revision,
        createdAtSec: entry.createdAtSec,
        updatedAtSec: entry.updatedAtSec,
      };
    }),
    nextCursor: page.nextCursor,
  };
}

export function fnResourceDataMutationResult(
  kind: 'kv' | 'secretStore',
  entry: TResourceKeyValueEntryMetadata & { readonly value?: TResourceJson },
): TResourceDataMutationResult {
  if (kind === 'secretStore') {
    return {
      kind,
      entry: {
        name: entry.key,
        revision: entry.revision,
        createdAtSec: entry.createdAtSec,
        updatedAtSec: entry.updatedAtSec,
      },
    };
  }
  const value = fnJsonValuePreview(entry.value ?? null);
  return {
    kind,
    entry: {
      key: entry.key,
      valuePreview: value.preview,
      valueTruncated: value.truncated,
      revision: entry.revision,
      createdAtSec: entry.createdAtSec,
      updatedAtSec: entry.updatedAtSec,
    },
  };
}
