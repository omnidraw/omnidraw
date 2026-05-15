import type { TWorkflowJson } from '@vibecanvas/service-workflow';

export type TVisualizerActorSeed = {
  readonly id: string;
  readonly definitionId: string;
  readonly revisionId: string;
  readonly elementId: string;
  readonly displayName: string;
  readonly x: number;
  readonly y: number;
  readonly initialState: string;
  readonly initialContext: TWorkflowJson;
  readonly machineConfig: TWorkflowJson;
  readonly serverManifest?: TWorkflowJson;
};

export type TVisualizerConnectionSeed = {
  readonly id: string;
  readonly sourceActorId: string;
  readonly targetActorId: string;
  readonly outputName?: string;
  readonly label?: string;
};

export type TVisualizerEffectArgs = {
  readonly state: string;
  readonly context: TWorkflowJson;
  readonly message: { readonly name: string; readonly payload: TWorkflowJson };
};

export type TVisualizerEffectResult = {
  readonly context?: TWorkflowJson;
  readonly outputs?: readonly { readonly name: string; readonly payload: TWorkflowJson }[];
};

export type TVisualizerRichTextInline =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'code'; readonly text: string }
  | { readonly kind: 'strong'; readonly text: string };

export type TVisualizerRichTextBlock =
  | { readonly kind: 'heading'; readonly text: string }
  | { readonly kind: 'paragraph'; readonly children: readonly TVisualizerRichTextInline[] }
  | { readonly kind: 'list'; readonly items: readonly (readonly TVisualizerRichTextInline[])[] };

export type TVisualizerExplainer = {
  readonly title: string;
  readonly x: number;
  readonly y: number;
  readonly blocks: readonly TVisualizerRichTextBlock[];
};

export type TVisualizerScenario = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly canvasId: string;
  readonly explainer: TVisualizerExplainer;
  readonly actors: readonly TVisualizerActorSeed[];
  readonly connections: readonly TVisualizerConnectionSeed[];
  readonly effects: Record<string, (args: TVisualizerEffectArgs) => Promise<TVisualizerEffectResult> | TVisualizerEffectResult>;
};
