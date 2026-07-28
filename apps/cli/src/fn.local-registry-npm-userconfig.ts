export type TArgs = Readonly<{
  homeDirectory: string;
  stateDirectory?: string;
  userConfigPath?: string;
  join: (...paths: string[]) => string;
}>;

export function fnLocalRegistryNpmUserConfig(args: TArgs): string {
  if (args.userConfigPath !== undefined && args.userConfigPath.trim() !== '') {
    return args.userConfigPath;
  }
  const stateDirectory = args.stateDirectory?.trim() || args.join(
    args.homeDirectory,
    '.local',
    'share',
    'vibecanvas',
    'registry',
  );
  return args.join(stateDirectory, 'npmrc');
}
