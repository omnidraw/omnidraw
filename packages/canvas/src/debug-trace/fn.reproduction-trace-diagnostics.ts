import type {
  TReproductionTraceDiagnostics,
} from './typed';

type TArgs = Readonly<{
  development: boolean;
  applicationVersion?: string;
  buildMode?: string;
  cangineVersion?: string;
}>;

export function fnReproductionTraceDiagnostics(
  args: TArgs,
): TReproductionTraceDiagnostics | false {
  if (!args.development) return false;
  return Object.freeze({
    reproductionTrace: true,
    applicationVersion: args.applicationVersion ?? 'unknown',
    buildMode: args.buildMode ?? 'development',
    cangineVersion: args.cangineVersion ?? 'unknown',
  });
}
