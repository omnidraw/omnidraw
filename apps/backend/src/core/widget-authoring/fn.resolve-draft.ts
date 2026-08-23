import type {
  TWidgetAuthoringCatalog,
  TWidgetAuthoringCatalogEntry,
  TWidgetAuthoringDraftResolutionDecision,
  TWidgetAuthoringDraftSelector,
} from './interface';

function failure(
  code: Extract<TWidgetAuthoringDraftResolutionDecision, { ok: false }>['failure']['code'],
  message: string,
): TWidgetAuthoringDraftResolutionDecision {
  return Object.freeze({ ok: false, failure: Object.freeze({ code, message }) });
}

function resolveHealthyDraft(
  catalog: TWidgetAuthoringCatalog,
  entry: TWidgetAuthoringCatalogEntry,
): TWidgetAuthoringDraftResolutionDecision {
  if (entry.draft === null) {
    return failure(
      'DRAFT_REQUIRED',
      entry.published
        ? `Widget '${entry.widgetKey}' is published-only. Create an editable draft explicitly before using automation.`
        : `Widget '${entry.widgetKey}' has no editable draft.`,
    );
  }
  if (entry.draft.health !== 'healthy') {
    return failure(
      'DRAFT_UNHEALTHY',
      `Widget '${entry.widgetKey}' has an unhealthy draft that must be repaired before automation can select it.`,
    );
  }
  return Object.freeze({
    ok: true,
    resolution: Object.freeze({
      catalogGeneration: catalog.generation,
      catalogDigestSha256: catalog.digestSha256,
      widgetKey: entry.widgetKey,
      displayName: entry.displayName,
      draftDigestSha256: entry.draft.digestSha256,
      draftRelativePath: entry.draft.relativePath,
    }),
  });
}

/** Resolves one exact existing draft from one already-pinned catalog generation. */
export function fnResolveWidgetAuthoringDraft(args: Readonly<{
  catalog: TWidgetAuthoringCatalog;
  selector: TWidgetAuthoringDraftSelector;
}>): TWidgetAuthoringDraftResolutionDecision {
  if (args.selector.widgetKey !== undefined) {
    const entry = args.catalog.entries.find(
      (candidate) => candidate.widgetKey === args.selector.widgetKey,
    );
    return entry === undefined
      ? failure('WIDGET_NOT_FOUND', `Widget '${args.selector.widgetKey}' was not found.`)
      : resolveHealthyDraft(args.catalog, entry);
  }

  const requested = args.selector.name;
  const folded = requested.toLocaleLowerCase('en-US');
  const caseMatches = args.catalog.entries.filter(
    (entry) => entry.displayName.toLocaleLowerCase('en-US') === folded,
  );
  if (caseMatches.length > 1) {
    const exactSpellings = new Set(caseMatches.map((entry) => entry.displayName));
    return failure(
      exactSpellings.size > 1 ? 'WIDGET_NAME_CASE_COLLISION' : 'WIDGET_NAME_AMBIGUOUS',
      `Widget name '${requested}' is ambiguous. Resolve the draft by its exact widget key.`,
    );
  }
  const entry = caseMatches[0];
  if (entry === undefined || entry.displayName !== requested) {
    return failure('WIDGET_NOT_FOUND', `Widget name '${requested}' was not found exactly.`);
  }
  return resolveHealthyDraft(args.catalog, entry);
}
