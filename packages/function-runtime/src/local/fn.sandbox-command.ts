/**
 * @file Pure Bun child-worker command construction.
 */

type TArgs = Readonly<{
  executable: string;
  workerPath: string;
  compiledExecutable: boolean;
}>;

export function fnBunFunctionWorkerCommand(args: TArgs): readonly string[] {
  return args.compiledExecutable
    ? [args.executable, '--function-worker']
    : [args.executable, args.workerPath, '--function-worker'];
}
