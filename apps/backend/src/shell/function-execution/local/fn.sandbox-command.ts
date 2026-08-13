/**
 * @file Pure Bun child-worker command construction.
 */

type TArgs = Readonly<{
  executable: string;
  workerPath: string;
}>;

export function fnBunFunctionWorkerCommand(args: TArgs): readonly string[] {
  return [args.executable, args.workerPath, '--function-worker'];
}
