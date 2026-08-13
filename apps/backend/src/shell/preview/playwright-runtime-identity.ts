import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { chromium } from 'playwright';
import playwrightPackage from 'playwright/package.json';

const MAXIMUM_VERSION_OUTPUT_BYTES = 4_096;
const VERSION_COMMAND_TIMEOUT_MS = 10_000;

export type TPlaywrightRuntimeExecutableEvidence = Readonly<{
  packageVersion: string;
  browserName: 'chromium';
  browserRevision: string;
  executablePath: string;
  executableSha256: string;
}>;

export type TPlaywrightRuntimeIdentity = TPlaywrightRuntimeExecutableEvidence & Readonly<{
  browserVersion: string;
}>;

export type TPlaywrightRuntimeIdentityEffects = Readonly<{
  packageVersion(): unknown;
  executablePath(): unknown;
  executableVersion(executablePath: string): Promise<unknown>;
  executableSha256(executablePath: string): Promise<unknown>;
}>;

function identityError(message: string): Error {
  return Object.assign(new Error(message), {
    code: 'BROWSER_RUNTIME_IDENTITY_INVALID',
  });
}

function extractBrowserRevision(executablePath: string): string | undefined {
  return executablePath.match(/(?:^|[\\/])chromium-(\d{1,10})(?:[\\/]|$)/)?.[1];
}

function extractBrowserVersion(versionOutput: string): string | undefined {
  const normalized = versionOutput.trim();
  if (normalized.length === 0 || normalized.length > MAXIMUM_VERSION_OUTPUT_BYTES) {
    return undefined;
  }
  return normalized.match(/(?:^|\s)(\d{1,3}(?:\.\d{1,7}){3})(?:\s|$)/)?.[1];
}

async function executableSha256(executablePath: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(executablePath)) hash.update(chunk);
  return hash.digest('hex');
}

async function executableVersion(executablePath: string): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    execFile(
      executablePath,
      ['--version'],
      {
        encoding: 'utf8',
        maxBuffer: MAXIMUM_VERSION_OUTPUT_BYTES,
        timeout: VERSION_COMMAND_TIMEOUT_MS,
        windowsHide: true,
      },
      (error, stdout) => {
        if (error !== null) reject(error);
        else resolve(stdout);
      },
    );
  });
}

const DEFAULT_IDENTITY_PORTAL: TPlaywrightRuntimeIdentityEffects = Object.freeze({
  packageVersion: () => playwrightPackage.version,
  executablePath: () => chromium.executablePath(),
  executableVersion,
  executableSha256,
});

/**
 * Reads package/path/revision and hashes the exact executable without executing
 * it. The caller validates this evidence before executing the version command.
 */
export async function readPlaywrightRuntimeExecutableEvidence(
  effects: TPlaywrightRuntimeIdentityEffects = DEFAULT_IDENTITY_PORTAL,
): Promise<TPlaywrightRuntimeExecutableEvidence> {
  const packageVersion = effects.packageVersion();
  const path = effects.executablePath();
  if (typeof packageVersion !== 'string' || packageVersion.length === 0) {
    throw identityError('The installed Playwright package version is unavailable.');
  }
  if (typeof path !== 'string' || path.length === 0) {
    throw identityError('The Playwright Chromium executable path is unavailable.');
  }

  const browserRevision = extractBrowserRevision(path);
  if (browserRevision === undefined) {
    throw identityError('The Playwright Chromium revision could not be verified.');
  }

  let rawSha256: unknown;
  try {
    rawSha256 = await effects.executableSha256(path);
  } catch {
    throw identityError('The Playwright Chromium executable could not be verified.');
  }
  if (typeof rawSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(rawSha256)) {
    throw identityError('The Playwright Chromium executable checksum is invalid.');
  }

  return Object.freeze({
    packageVersion,
    browserName: 'chromium',
    browserRevision,
    executablePath: path,
    executableSha256: rawSha256,
  });
}

/** Executes `--version` only after the caller has accepted the hash evidence. */
export async function readPlaywrightRuntimeIdentityFromEvidence(
  evidence: TPlaywrightRuntimeExecutableEvidence,
  effects: Pick<TPlaywrightRuntimeIdentityEffects, 'executableVersion'> = DEFAULT_IDENTITY_PORTAL,
): Promise<TPlaywrightRuntimeIdentity> {
  let rawVersion: unknown;
  try {
    rawVersion = await effects.executableVersion(evidence.executablePath);
  } catch {
    throw identityError('The Playwright Chromium executable could not be verified.');
  }
  const browserVersion = typeof rawVersion === 'string'
    ? extractBrowserVersion(rawVersion)
    : undefined;
  if (browserVersion === undefined) {
    throw identityError('The Playwright Chromium version is invalid.');
  }
  return Object.freeze({ ...evidence, browserVersion });
}

/** Convenience composition for callers that do not need the two validation phases separately. */
export async function readPlaywrightRuntimeIdentity(
  effects: TPlaywrightRuntimeIdentityEffects = DEFAULT_IDENTITY_PORTAL,
): Promise<TPlaywrightRuntimeIdentity> {
  const evidence = await readPlaywrightRuntimeExecutableEvidence(effects);
  return await readPlaywrightRuntimeIdentityFromEvidence(evidence, effects);
}
