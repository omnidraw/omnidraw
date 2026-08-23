import type { IWidgetBrowserMount } from "@omnidraw/sdk";

type TRetireFatalWidgetMountArgs = Readonly<{
  canRenderFailure(): boolean;
  detach(mount: IWidgetBrowserMount): void;
  error: unknown;
  failedMount: IWidgetBrowserMount;
  isCurrent(): boolean;
  renderFailure(error: unknown): void;
  retire(): void;
}>;

/** Quarantines a fatal mount before awaiting teardown, then owns its durable failure state. */
export async function retireFatalWidgetMount(args: TRetireFatalWidgetMountArgs): Promise<boolean> {
  if (!args.isCurrent()) return false;
  args.retire();
  args.detach(args.failedMount);
  await args.failedMount.dispose("fatal-runtime").catch(() => undefined);
  if (args.canRenderFailure()) args.renderFailure(args.error);
  return true;
}
