import type { Json } from 'effect/Schema';

export const WIDGET_SUBCOMMANDS = ['list', 'resolve', 'validate', 'inspect'] as const;
export type TWidgetCliSubcommand = typeof WIDGET_SUBCOMMANDS[number];

export type TParsedWidgetCommand =
  | Readonly<{ subcommand: 'list'; input: null }>
  | Readonly<{
      subcommand: 'resolve';
      input: Readonly<{ widgetKey: string } | { name: string }>;
    }>
  | Readonly<{
      subcommand: 'validate';
      input: Readonly<{ widgetKey: string; expectedDraftDigestSha256?: string }>;
    }>
  | Readonly<{
      subcommand: 'inspect';
      input: Json & Readonly<{
        widgetKey: string;
        expectedDraftDigestSha256: string;
        expectedAcceptedGeneration: number;
        expectedBuildIdentity: string;
        mode: 'artifact' | 'preview';
        canvasId?: string;
        includeScreenshot: boolean;
        operationId: string;
      }>;
      screenshotPath?: string;
      overwrite: boolean;
    }>;
