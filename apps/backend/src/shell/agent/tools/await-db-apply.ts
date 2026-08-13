import { fnDbApplyTerminalStatus } from './fn.resource-tools';
import type { TAgentResourceService } from './resource-service';

export type TEffects = {
  readonly getDbApply: NonNullable<TAgentResourceService['getDbApply']>;
  readonly sleep: (ms: number) => Promise<void>;
  readonly now: () => number;
};

export type TArgs = {
  readonly applyId: string;
  readonly fallback: Readonly<{ id: string; status: string }>;
  readonly deadlineMs: number;
  readonly intervalMs: number;
};

export async function awaitDbApplyTerminal(
  effects: TEffects,
  args: TArgs,
): Promise<Readonly<{ id: string; status: string }>> {
  let last: Readonly<{ id: string; status: string }> = args.fallback;
  const deadline = effects.now() + args.deadlineMs;
  while (!fnDbApplyTerminalStatus(last.status)) {
    const snapshot = await effects.getDbApply(args.applyId).catch(() => null);
    if (snapshot) last = snapshot.apply;
    if (fnDbApplyTerminalStatus(last.status) || effects.now() >= deadline) break;
    await effects.sleep(args.intervalMs);
  }
  return last;
}
