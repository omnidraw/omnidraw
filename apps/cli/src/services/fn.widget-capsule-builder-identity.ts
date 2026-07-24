type TArgs = Readonly<{
  imageId: string;
  serverBunVersion: string;
}>;

export function fnWidgetCapsuleBuilderIdentity(args: TArgs): string {
  return [
    'vibecanvas-build-adapter/v1',
    `vibecanvas-widget-capsule-oci/${args.imageId}`,
    `server-bun/${args.serverBunVersion}`,
  ].join(';');
}
