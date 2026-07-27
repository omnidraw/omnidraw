type TArgs = Readonly<{
  npmVersion: string;
  serverBunVersion: string;
}>;

export function fnWidgetCapsuleBuilderIdentity(args: TArgs): string {
  return [
    'vibecanvas-build-adapter/v2',
    `host-npm/${args.npmVersion}`,
    `server-bun/${args.serverBunVersion}`,
  ].join(';');
}
