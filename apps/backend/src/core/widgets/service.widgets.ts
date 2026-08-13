import { Context, type Effect, type Stream } from 'effect';

export type TWidgetCatalogEntry = Readonly<{
  widgetKey: string;
  generation: number;
  catalogDigestSha256: string;
  draftManifestDigestSha256: string | null;
  available: boolean;
}>;

export type TWidgetPublicationRequest = Readonly<{
  widgetKey: string;
  expectedGeneration: number;
  expectedCatalogDigestSha256: string;
  expectedManifestDigestSha256: string;
}>;

export type TWidgetPublicationResult = Readonly<{
  widgetKey: string;
  generation: number;
  published: boolean;
}>;

export class WidgetProgramError extends Error {
  readonly code: string;
  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'WidgetProgramError';
    this.code = code;
  }
}

export interface IWidgetAuthority {
  readonly catalog: () => Effect.Effect<readonly TWidgetCatalogEntry[], WidgetProgramError>;
  readonly publish: (
    args: TWidgetPublicationRequest,
  ) => Effect.Effect<TWidgetPublicationResult, WidgetProgramError>;
  readonly events: (
    args: Readonly<{ afterGeneration?: number }>,
  ) => Effect.Effect<Stream.Stream<TWidgetPublicationResult, WidgetProgramError>, WidgetProgramError>;
}

export class WidgetAuthority extends Context.Service<WidgetAuthority, IWidgetAuthority>()(
  'omnidraw/backend/WidgetAuthority',
) {}
