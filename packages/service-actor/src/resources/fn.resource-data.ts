import type { TJson } from '@vibecanvas/service-db/model';
import type { TActorResourceKeyValueEntryMetadata } from './ActorResourceKeyValuePersistence';
import type { TActorResourceDataMutationResult, TActorResourceDataPage } from './resource-types';

const VALUE_PREVIEW_MAX_LENGTH = 4_096;

export function fnJsonValuePreview(value: TJson): { preview: string; truncated: boolean } {
  const serialized = JSON.stringify(value) ?? 'null';
  if (serialized.length <= VALUE_PREVIEW_MAX_LENGTH) return { preview: serialized, truncated: false };
  return { preview: serialized.slice(0, VALUE_PREVIEW_MAX_LENGTH), truncated: true };
}

export function fnActorResourceDataPage(
  kind: 'kv' | 'secretStore',
  page: {
    entries: readonly (TActorResourceKeyValueEntryMetadata & { readonly value?: TJson })[];
    nextCursor: string | null;
  },
): TActorResourceDataPage {
  if (kind === 'secretStore') {
    return {
      kind,
      entries: page.entries.map((entry) => ({
        name: entry.key,
        revision: entry.revision,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
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
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
      };
    }),
    nextCursor: page.nextCursor,
  };
}

export function fnActorResourceDataMutationResult(
  kind: 'kv' | 'secretStore',
  entry: TActorResourceKeyValueEntryMetadata & { readonly value?: TJson },
): TActorResourceDataMutationResult {
  if (kind === 'secretStore') {
    return {
      kind,
      entry: {
        name: entry.key,
        revision: entry.revision,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
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
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    },
  };
}
