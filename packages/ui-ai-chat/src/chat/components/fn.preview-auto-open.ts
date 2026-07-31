import {
  fnGetWidgetCreateDraftReference,
} from './tabs/fn.tool-call';
import type {
  TChatWidgetDraftReference,
} from './tabs/fn.tool-call';

const LOWERCASE_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_AUTO_OPENED_PREVIEW_DRAFT_IDS = 16;

function messageFinished(message: unknown): boolean {
  if (typeof message !== 'object' || message === null) return true;
  if (!('__omnidrawMessageFinished' in message)) return true;
  return message.__omnidrawMessageFinished !== false;
}

export function fnNormalizeAutoOpenedPreviewDraftIds(
  value: unknown,
): string[] {
  if (!Array.isArray(value)) return [];
  const normalized: string[] = [];
  for (const candidate of value) {
    if (normalized.length >= MAX_AUTO_OPENED_PREVIEW_DRAFT_IDS) break;
    if (
      typeof candidate === 'string'
      && LOWERCASE_UUID_PATTERN.test(candidate)
      && !normalized.includes(candidate)
    ) {
      normalized.push(candidate);
    }
  }
  return normalized;
}

export function fnFirstAutoOpenWidgetPreviewReference(
  messages: readonly unknown[],
  autoOpenedPreviewDraftIds: unknown,
): TChatWidgetDraftReference | undefined {
  if (fnNormalizeAutoOpenedPreviewDraftIds(
    autoOpenedPreviewDraftIds,
  ).length > 0) return undefined;

  for (const message of messages) {
    if (!messageFinished(message)) continue;
    const reference = fnGetWidgetCreateDraftReference(message);
    if (reference === undefined) continue;
    return reference.draftId === undefined ? undefined : reference;
  }
  return undefined;
}

export function fnRecordAutoOpenedPreviewDraftId(
  value: unknown,
  draftId: string,
): string[] {
  const normalized = fnNormalizeAutoOpenedPreviewDraftIds(value);
  if (
    !LOWERCASE_UUID_PATTERN.test(draftId)
    || normalized.includes(draftId)
  ) return normalized;
  return [
    ...normalized.slice(-(MAX_AUTO_OPENED_PREVIEW_DRAFT_IDS - 1)),
    draftId,
  ];
}

export function fnWidgetPreviewReferenceKey(
  reference: TChatWidgetDraftReference,
): string {
  return reference.draftId ?? `name:${reference.name}`;
}
