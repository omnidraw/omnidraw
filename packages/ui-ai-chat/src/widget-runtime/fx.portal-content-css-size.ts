export type TPortal = Readonly<{
  readClientWidth(host: HTMLElement): number;
  readClientHeight(host: HTMLElement): number;
}>;

export type TArgs = Readonly<{
  host: HTMLElement;
}>;

export function fxPortalContentCssSize(
  portal: TPortal,
  args: TArgs,
): Readonly<{ width: number; height: number }> {
  const width = portal.readClientWidth(args.host);
  const height = portal.readClientHeight(args.host);
  return Object.freeze({
    width: Number.isFinite(width) ? Math.max(0, Math.trunc(width)) : 0,
    height: Number.isFinite(height) ? Math.max(0, Math.trunc(height)) : 0,
  });
}
