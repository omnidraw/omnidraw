export type TPortal = Readonly<{
  platform: string;
  killProcessGroup(pid: number): void;
  taskkill(pid: number): Promise<boolean>;
}>;

export type TArgs = Readonly<{
  pid: number | undefined;
  killDirect(): void;
}>;

export async function txTerminateWidgetBuildProcessTree(
  portal: TPortal,
  args: TArgs,
): Promise<void> {
  if (portal.platform !== 'win32' && args.pid !== undefined) {
    try {
      portal.killProcessGroup(args.pid);
      return;
    } catch {
      // The group may already have exited; the direct child is the safe fallback.
    }
  }
  if (portal.platform === 'win32' && args.pid !== undefined) {
    if (await portal.taskkill(args.pid)) return;
  }
  args.killDirect();
}
