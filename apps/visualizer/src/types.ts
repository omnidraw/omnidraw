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

export type TVisualizerScenario = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly canvasId: string;
  readonly actors: readonly TVisualizerActorSeed[];
  readonly connections: readonly TVisualizerConnectionSeed[];
  readonly effects: Record<string, (args: TVisualizerEffectArgs) => Promise<TVisualizerEffectResult> | TVisualizerEffectResult>;
};
