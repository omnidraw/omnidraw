type TBuildActorIpcCommandArgs = {
  readonly functionPath: string;
  readonly compiled?: boolean;
  readonly execPath?: string;
  readonly icpClientPath?: string;
};

declare const VIBECANVAS_COMPILED: boolean | undefined;

export function isCompiledActorRuntime(): boolean {
  return (
    (typeof VIBECANVAS_COMPILED !== "undefined" && VIBECANVAS_COMPILED) ||
    process.env.VIBECANVAS_COMPILED === "true" ||
    Bun.argv[1]?.startsWith("/$bunfs/") === true
  );
}

export function buildActorIpcCommand(args: TBuildActorIpcCommandArgs): string[] {
  const childArgs = ["--icp-client", "--functionPath", args.functionPath];
  const execPath = args.execPath ?? process.execPath;

  if (args.compiled ?? isCompiledActorRuntime()) {
    return [execPath, ...childArgs];
  }

  const icpClientPath = args.icpClientPath ?? new URL("icp-client.ts", import.meta.url).pathname;
  return [execPath, icpClientPath, ...childArgs];
}
