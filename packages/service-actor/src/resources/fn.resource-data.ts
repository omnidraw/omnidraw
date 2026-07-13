import type { TActorResourceKeyValue, TJson } from '@vibecanvas/service-db/model';
import type { TActorResourceDataPage } from './resource-types';

const VALUE_PREVIEW_MAX_LENGTH = 4_096;

export function fnJsonValuePreview(value: TJson): { preview: string; truncated: boolean } {
  const serialized = JSON.stringify(value) ?? 'null';
  if (serialized.length <= VALUE_PREVIEW_MAX_LENGTH) return { preview: serialized, truncated: false };
  return { preview: serialized.slice(0, VALUE_PREVIEW_MAX_LENGTH), truncated: true };
}

export function fnActorResourceDataPage(
  kind: 'kv' | 'secretStore',
  page: { entries: readonly TActorResourceKeyValue[]; nextCursor: string | null },
): TActorResourceDataPage {
  if (kind === 'secretStore') {
    return {
      kind,
      entries: page.entries.map((entry) => ({
        name: entry.key,
        revision: entry.revision,
        createdAt: entry.created_at,
        updatedAt: entry.updated_at,
      })),
      nextCursor: page.nextCursor,
    };
  }
  return {
    kind,
    entries: page.entries.map((entry) => {
      const value = fnJsonValuePreview(entry.value);
      return {
        key: entry.key,
        valuePreview: value.preview,
        valueTruncated: value.truncated,
        revision: entry.revision,
        createdAt: entry.created_at,
        updatedAt: entry.updated_at,
      };
    }),
    nextCursor: page.nextCursor,
  };
}
