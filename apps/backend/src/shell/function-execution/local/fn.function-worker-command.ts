/**
 * @file Pure Bun child-worker command construction for trusted local execution.
 */

type TArgs = Readonly<{
  executable: string;
  workerPath: string;
}>;

export function fnBunFunctionWorkerCommand(args: TArgs): readonly string[] {
  return [args.executable, args.workerPath, '--function-worker'];
}
