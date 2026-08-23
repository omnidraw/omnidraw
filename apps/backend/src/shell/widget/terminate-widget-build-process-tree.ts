export type TEffects = Readonly<{
  platform: string;
  killProcessGroup(pid: number): void;
  taskkill(pid: number): Promise<boolean>;
}>;

export type TArgs = Readonly<{
  pid: number | undefined;
  killDirect(): void;
}>;

export async function terminateWidgetBuildProcessTree(
  effects: TEffects,
  args: TArgs,
): Promise<void> {
  if (effects.platform !== 'win32' && args.pid !== undefined) {
    try {
      effects.killProcessGroup(args.pid);
      return;
    } catch {
      // The group may already have exited; the direct child is the safe fallback.
    }
  }
  if (effects.platform === 'win32' && args.pid !== undefined) {
    if (await effects.taskkill(args.pid)) return;
  }
  args.killDirect();
}
