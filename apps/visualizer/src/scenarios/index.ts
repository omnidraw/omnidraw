import { counterChainScenario } from './counter-chain';
import { pingPongScenario } from './ping-pong';
import type { TVisualizerScenario } from '../types';

export const VISUALIZER_SCENARIOS: readonly TVisualizerScenario[] = [pingPongScenario, counterChainScenario];

export function getScenario(id: string | null | undefined): TVisualizerScenario {
  return VISUALIZER_SCENARIOS.find((scenario) => scenario.id === id) ?? VISUALIZER_SCENARIOS[0]!;
}
