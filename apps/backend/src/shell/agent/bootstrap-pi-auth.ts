import { constants, type Stats } from 'node:fs';
import type {
  chmod,
  copyFile,
  lstat,
  mkdir,
  stat,
  unlink,
} from 'node:fs/promises';
import type { dirname, join } from 'node:path';

type TBootstrapPiAuthEffects = Readonly<{
  chmod: typeof chmod;
  copyFile: typeof copyFile;
  dirname: typeof dirname;
  lstat: typeof lstat;
  mkdir: typeof mkdir;
  stat: typeof stat;
  unlink: typeof unlink;
}>;

type TBootstrapPiAuthArgs = Readonly<{
  sourceAuthPath: string;
  destinationAuthPath: string;
}>;

type TBootstrapPiAuthResult = Readonly<{
  status: 'copied' | 'destination-exists' | 'source-missing';
  sourceAuthPath: string;
  destinationAuthPath: string;
}>;

function errorCode(error: unknown): string | null {
  return error !== null
    && typeof error === 'object'
    && 'code' in error
    && typeof error.code === 'string'
    ? error.code
    : null;
}

async function optionalStat(
  inspect: (path: string) => Promise<Stats>,
  path: string,
): Promise<Stats | null> {
  try {
    return await inspect(path);
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return null;
    throw error;
  }
}

/**
 * Imports Pi's normal user credential file once without parsing, merging, or
 * overwriting credentials. ModelRuntime remains the format authority.
 */
export async function bootstrapPiAuth(
  effects: TBootstrapPiAuthEffects,
  args: TBootstrapPiAuthArgs,
): Promise<TBootstrapPiAuthResult> {
  const result = (status: TBootstrapPiAuthResult['status']): TBootstrapPiAuthResult => (
    Object.freeze({ status, ...args })
  );
  if (await optionalStat(effects.lstat, args.destinationAuthPath) !== null) {
    return result('destination-exists');
  }

  const source = await optionalStat(effects.stat, args.sourceAuthPath);
  if (source === null) return result('source-missing');
  if (!source.isFile()) {
    throw new Error(`Pi auth bootstrap source is not a regular file: ${args.sourceAuthPath}`);
  }

  const destinationDirectory = effects.dirname(args.destinationAuthPath);
  await effects.mkdir(destinationDirectory, {
    recursive: true,
    mode: 0o700,
  });
  await effects.chmod(destinationDirectory, 0o700);
  try {
    await effects.copyFile(
      args.sourceAuthPath,
      args.destinationAuthPath,
      constants.COPYFILE_EXCL,
    );
  } catch (error) {
    if (errorCode(error) === 'EEXIST') return result('destination-exists');
    try {
      await effects.unlink(args.destinationAuthPath);
    } catch (cleanupError) {
      if (errorCode(cleanupError) !== 'ENOENT') {
        throw new AggregateError(
          [error, cleanupError],
          `Pi auth bootstrap could not copy or clean up ${args.destinationAuthPath}`,
        );
      }
    }
    throw error;
  }

  try {
    await effects.chmod(args.destinationAuthPath, 0o600);
  } catch (error) {
    try {
      await effects.unlink(args.destinationAuthPath);
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        `Pi auth bootstrap could not secure or remove ${args.destinationAuthPath}`,
      );
    }
    throw error;
  }
  return result('copied');
}

export function fnOmnidrawPiAgentDirectory(
  joinPath: typeof join,
  agentRoot: string,
): string {
  return joinPath(agentRoot, 'pi', 'agent');
}

export type {
  TBootstrapPiAuthArgs,
  TBootstrapPiAuthEffects,
  TBootstrapPiAuthResult,
};
