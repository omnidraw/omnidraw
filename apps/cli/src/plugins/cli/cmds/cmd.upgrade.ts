import { createHash } from 'crypto';
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { parseArgs } from 'util';
import type { ICliConfig } from '../../../config';
import { fnCliUpdateResolvePolicy } from '../core/fn.resolve-policy';
import { fnCliUpdateShouldUpgrade } from '../core/fn.should-upgrade';
import {
  fnDownloadMonotonicPercent,
  fnDownloadOverallPercent,
  fnFormatDownloadLabel,
  fnShouldEmitProgress,
  type TDownloadProgress,
} from './fn.download-progress';

type TInstallMethod = 'curl' | 'npm' | 'unknown';

type TUpdatePolicy = {
  mode: 'disabled' | 'notify' | 'install';
  reason: 'env' | 'config' | 'method' | 'default';
};

type TLatestVersion = {
  version: string;
  channel: string;
};

type TUpgradeProgressEvent = {
  percent: number;
  label: string;
  download?: TDownloadProgress;
};

type TUpgradeResult =
  | { status: 'updated'; version: string; method: TInstallMethod }
  | { status: 'up-to-date'; version: string; method: TInstallMethod }
  | { status: 'update-available'; version: string; method: TInstallMethod; command?: string; message?: string }
  | { status: 'dry-run-ok'; version: string; method: TInstallMethod; message: string }
  | { status: 'dry-run-failed'; version: string; method: TInstallMethod; message: string; command?: string }
  | { status: 'disabled'; method: TInstallMethod; reason: TUpdatePolicy['reason'] }
  | { status: 'error'; method: TInstallMethod; message: string };

type TConfigFile = {
  autoupdate?: boolean | 'notify';
};

type TFailedUpgrade = { version: string; reason: string };

type TRunUpgradeArgs = {
  config: ICliConfig;
};

type TCheckForUpgradeArgs = {
  config: ICliConfig;
  checkOnly?: boolean;
  dryRun?: boolean;
  methodOverride?: TInstallMethod;
  targetVersionOverride?: string;
  onProgress?: (event: TUpgradeProgressEvent) => void;
};

type TApplyUpgradeArgs = {
  method: TInstallMethod;
  version: string;
  channel: string;
  onProgress?: (event: TUpgradeProgressEvent) => void;
};

type TApplyUpgradeResult = {
  ok: boolean;
  command?: string;
  message?: string;
};

type TReleaseAssetDescriptor = {
  packageName: string;
  archiveName: string;
  checksumName: string;
  binaryName: string;
  isWindows: boolean;
};

type TDryRunResult = {
  ok: boolean;
  message: string;
};

const ANSI_RESET = '\x1b[0m';
const RELEASES_API = 'https://api.github.com/repos/omnidraw/omnidraw/releases' as const;
const RELEASE_DOWNLOAD_BASE =
  (typeof OMNIDRAW_RELEASE_DOWNLOAD_BASE !== 'undefined' && OMNIDRAW_RELEASE_DOWNLOAD_BASE) ||
  'https://github.com/omnidraw/omnidraw/releases/download';
const UPDATE_CHANNELS = ['stable', 'beta', 'nightly'] as const;
const DOWNLOAD_PROGRESS_START = 85;
const DOWNLOAD_PROGRESS_END = 91;
const DOWNLOAD_INACTIVITY_TIMEOUT_MS = 30_000;
const CANDIDATE_TIMEOUT_MS = 8_000;

function printUpgradeHelp(): void {
  console.log(`Usage: omnidraw upgrade [options]

Options:
  --check              Check for updates without installing
  --dry-run            Download candidate build and validate startup on a temp copy
  --method <method>    Override install method (curl, npm, unknown)
  --target-version <v> Target specific version (leading "v" optional)
  --help, -h           Show this help message
`);
}

function getServerVersion(config: ICliConfig): string {
  return config.version;
}

function getUpdateChannel(): (typeof UPDATE_CHANNELS)[number] {
  const channel =
    (typeof OMNIDRAW_CHANNEL !== 'undefined' && OMNIDRAW_CHANNEL) ||
    process.env.OMNIDRAW_CHANNEL;
  if (channel === 'stable' || channel === 'beta' || channel === 'nightly') {
    return channel;
  }
  return 'stable';
}

function getExecPath(): string {
  return process.execPath;
}

function detectInstallMethod(): TInstallMethod {
  const execPath = getExecPath().toLowerCase();

  if (execPath.includes('.omnidraw/bin') || execPath.includes('.omnidraw\\bin')) {
    return 'curl';
  }

  if (execPath.includes('node_modules') || execPath.includes('bunx') || execPath.includes('npm')) {
    return 'npm';
  }

  return 'unknown';
}

function readConfigAutoupdate(config: ICliConfig): boolean | 'notify' | undefined {
  const configFilePath = config.home.configFilePath;
  if (!existsSync(configFilePath)) return undefined;

  try {
    const raw = readFileSync(configFilePath, 'utf8');
    const parsed = JSON.parse(raw) as TConfigFile;
    return parsed.autoupdate;
  } catch {
    return undefined;
  }
}

function resolveUpdatePolicy(config: ICliConfig, method: TInstallMethod): TUpdatePolicy {
  const [policy] = fnCliUpdateResolvePolicy({
    method,
    configAutoupdate: readConfigAutoupdate(config),
    envDisable: process.env.OMNIDRAW_DISABLE_AUTOUPDATE,
  });

  return policy ?? { mode: 'notify', reason: 'default' };
}

function failedUpgradePath(config: ICliConfig): string {
  return join(config.home.logsRoot, 'failed-upgrade.json');
}

function readFailedUpgrade(config: ICliConfig): TFailedUpgrade | null {
  try {
    return JSON.parse(readFileSync(failedUpgradePath(config), 'utf8')) as TFailedUpgrade;
  } catch {
    return null;
  }
}

async function writeFailedUpgrade(config: ICliConfig, failure: TFailedUpgrade | null): Promise<void> {
  const path = failedUpgradePath(config);
  if (!failure) {
    rmSync(path, { force: true });
    return;
  }
  mkdirSync(config.home.logsRoot, { recursive: true, mode: 0o700 });
  await Bun.write(path, `${JSON.stringify(failure, null, 2)}\n`);
}

function extractVersionFromTag(tag: string): string {
  return tag.replace(/^omnidraw-v/i, '').replace(/^v/i, '');
}

function isStableReleaseTag(tag: string): boolean {
  return /^omnidraw-v\d+\.\d+\.\d+$/i.test(tag);
}

async function fetchLatestVersion(targetVersionOverride?: string): Promise<TLatestVersion | null> {
  const channel = getUpdateChannel();

  if (targetVersionOverride) {
    return { version: extractVersionFromTag(targetVersionOverride), channel };
  }

  const response = await fetch(`${RELEASES_API}?per_page=50`);
  if (!response.ok) return null;

  const releases = (await response.json()) as Array<{ tag_name?: string }>;
  const match = channel === 'stable'
    ? releases.find((release) => release.tag_name ? isStableReleaseTag(release.tag_name) : false)
    : releases.find((release) => release.tag_name?.toLowerCase().includes(`-${channel}`));
  if (!match?.tag_name) return null;

  return { version: extractVersionFromTag(match.tag_name), channel };
}

function createUpgradeProgressRenderer() {
  const isTTY = Boolean(process.stdout.isTTY);
  const columns = process.stdout.columns ?? 80;
  const updateColor = Bun.color('#60a5fa', 'ansi') ?? '';
  const labelColor = Bun.color('#34d399', 'ansi') ?? '';
  const barColor = Bun.color('#22c55e', 'ansi') ?? '';

  let lastPercent = -1;
  let lastLabel = '';
  let lastEmittedAtMs = -1;

  function clampPercent(value: number): number {
    return Math.max(0, Math.min(100, Math.round(value)));
  }

  function renderBar(percent: number): string {
    const barSize = 24;
    const filled = Math.round((percent / 100) * barSize);
    const empty = barSize - filled;
    const fill = '#'.repeat(filled);
    const rest = '-'.repeat(empty);
    return `${barColor}[${fill}${rest}]${ANSI_RESET}`;
  }

  function renderLine(percent: number, label: string): string {
    const line = `${updateColor}[Update]${ANSI_RESET} ${labelColor}${label}${ANSI_RESET} ${renderBar(percent)} ${percent}%`;
    return Bun.wrapAnsi(line, columns, { hard: true, wordWrap: true, trim: true }).replaceAll('\n', ' ');
  }

  function update(event: TUpgradeProgressEvent): void {
    const percent = clampPercent(event.percent);
    const label = event.label;
    const nowMs = Date.now();

    if (event.download && !fnShouldEmitProgress({
      nowMs,
      lastEmittedAtMs,
      percent,
      lastPercent,
      label,
      lastLabel,
      isTTY,
      isIndeterminate: event.download.totalBytes === undefined,
    })) return;

    if (!isTTY) {
      if (percent === lastPercent && label === lastLabel) return;
      console.log(`[Update] ${label} (${percent}%)`);
      lastPercent = percent;
      lastLabel = label;
      lastEmittedAtMs = nowMs;
      return;
    }

    const line = renderLine(percent, label);
    process.stdout.write(`\r\x1b[2K${line}`);
    lastPercent = percent;
    lastLabel = label;
    lastEmittedAtMs = nowMs;
  }

  function finish(): void {
    if (!isTTY) return;
    process.stdout.write('\n');
  }

  return { update, finish };
}

function commandForMethod(method: TInstallMethod, version: string): string | undefined {
  if (method === 'npm') return `npm install -g omnidraw@${version}`;
  return undefined;
}

async function runTextCommand(cmd: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn({
    cmd,
    stdout: 'pipe',
    stderr: 'pipe',
    env: process.env,
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return { exitCode, stdout, stderr };
}

async function detectNeedsBaselineBinary(): Promise<boolean> {
  if (process.arch !== 'x64') return false;

  if (process.platform === 'linux') {
    try {
      const cpuInfo = await Bun.file('/proc/cpuinfo').text();
      return !/\bavx2\b/i.test(cpuInfo);
    } catch {
      return false;
    }
  }

  if (process.platform === 'darwin') {
    try {
      const result = await runTextCommand(['sysctl', '-n', 'hw.optional.avx2_0']);
      return result.exitCode === 0 ? result.stdout.trim() !== '1' : false;
    } catch {
      return false;
    }
  }

  return false;
}

async function detectMuslRuntime(): Promise<boolean> {
  if (process.platform !== 'linux') return false;
  if (existsSync('/etc/alpine-release')) return true;

  try {
    const result = await runTextCommand(['ldd', '--version']);
    const output = `${result.stdout}\n${result.stderr}`;
    return /musl/i.test(output);
  } catch {
    return false;
  }
}

async function buildReleaseAssetDescriptor(): Promise<TReleaseAssetDescriptor> {
  const osMap: Record<string, string> = {
    darwin: 'darwin',
    linux: 'linux',
    win32: 'windows',
  };
  const archMap: Record<string, string> = {
    arm64: 'arm64',
    x64: 'x64',
  };

  const os = osMap[process.platform];
  const arch = archMap[process.arch];
  if (!os || !arch) {
    throw new Error(`Unsupported platform for upgrade dry-run: ${process.platform}-${process.arch}`);
  }

  const parts = ['omnidraw', os, arch];
  if (await detectNeedsBaselineBinary()) {
    parts.push('baseline');
  }
  if (await detectMuslRuntime()) {
    parts.push('musl');
  }

  const packageName = parts.join('-');
  const isWindows = process.platform === 'win32';
  const archiveName = `${packageName}${isWindows ? '.zip' : '.tar.gz'}`;
  const checksumName = `${packageName}.sha256`;
  const binaryName = `omnidraw${isWindows ? '.exe' : ''}`;

  return { packageName, archiveName, checksumName, binaryName, isWindows };
}

type TDownloadFileOptions = {
  inactivityTimeoutMs?: number;
  onProgress?: (progress: TDownloadProgress) => void;
  fetchImpl?: typeof fetch;
};

async function downloadFile(url: string, destinationPath: string, options: TDownloadFileOptions = {}): Promise<void> {
  const controller = new AbortController();
  const response = await (options.fetchImpl ?? fetch)(url, {
    headers: {
      'user-agent': 'omnidraw-upgrade',
    },
    redirect: 'follow',
    signal: controller.signal,
  });

  if (!response.ok) {
    throw new Error(`Download failed (${response.status}) for ${url}`);
  }

  if (!response.body) throw new Error(`Download returned no body for ${url}`);

  const contentLength = response.headers.get('content-length');
  const parsedTotal = contentLength === null ? undefined : Number(contentLength);
  const totalBytes = parsedTotal !== undefined && Number.isFinite(parsedTotal) && parsedTotal >= 0
    ? parsedTotal
    : undefined;
  const reader = response.body.getReader();
  const writer = Bun.file(destinationPath).writer();
  const inactivityTimeoutMs = options.inactivityTimeoutMs ?? DOWNLOAD_INACTIVITY_TIMEOUT_MS;
  let downloadedBytes = 0;
  let completed = false;

  options.onProgress?.({ downloadedBytes, totalBytes });
  try {
    while (true) {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const stalled = new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(new Error(`Download stalled for ${inactivityTimeoutMs / 1_000}s: ${url}`));
        }, inactivityTimeoutMs);
      });
      const result = await Promise.race([reader.read(), stalled]).finally(() => clearTimeout(timeout));
      if (result.done) break;
      if (!result.value.byteLength) continue;
      writer.write(result.value);
      downloadedBytes += result.value.byteLength;
      options.onProgress?.({ downloadedBytes, totalBytes });
    }
    await writer.flush();
    completed = true;
  } finally {
    controller.abort();
    try {
      await reader.cancel();
    } catch {
      // The reader may already be closed or aborted.
    }
    try {
      await writer.end();
    } finally {
      if (!completed) rmSync(destinationPath, { force: true });
    }
  }
}

function createDownloadProgressReporter(
  assetName: string,
  startPercent: number,
  endPercent: number,
  onProgress?: (event: TUpgradeProgressEvent) => void,
): (progress: TDownloadProgress) => void {
  let lastPercent = startPercent;
  return (download) => {
    lastPercent = fnDownloadMonotonicPercent(
      lastPercent,
      fnDownloadOverallPercent(download, startPercent, endPercent),
    );
    onProgress?.({
      percent: lastPercent,
      label: fnFormatDownloadLabel(assetName, download),
      download,
    });
  };
}

async function verifyFileChecksum(filePath: string, checksumPath: string): Promise<void> {
  const checksumText = (await Bun.file(checksumPath).text()).trim();
  const expected = checksumText.split(/\s+/)[0]?.trim();
  if (!expected) {
    throw new Error(`Malformed checksum file: ${checksumPath}`);
  }

  const buffer = await Bun.file(filePath).arrayBuffer();
  const actual = createHash('sha256').update(Buffer.from(buffer)).digest('hex');
  if (actual !== expected) {
    throw new Error(`Checksum mismatch for ${filePath}`);
  }
}

async function extractArchive(archivePath: string, outputDir: string, isWindows: boolean): Promise<void> {
  mkdirSync(outputDir, { recursive: true });
  const cmd = isWindows
    ? ['unzip', '-q', archivePath, '-d', outputDir]
    : ['tar', '-xzf', archivePath, '-C', outputDir];
  const result = await runTextCommand(cmd);
  if (result.exitCode !== 0) {
    throw new Error(`Failed to extract archive: ${(result.stderr || result.stdout).trim()}`);
  }
}

function findExtractedBinary(extractDir: string, binaryName: string): string {
  const candidates = [
    join(extractDir, binaryName),
    join(extractDir, 'bin', binaryName),
    join(extractDir, 'package', 'bin', binaryName),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(`Could not find ${binaryName} in extracted archive`);
}

async function executeCandidateBinary(binaryPath: string, tempConfigDir: string): Promise<{ exitCode: number; stdout: string; stderr: string; timedOut: boolean }> {
  const proc = Bun.spawn({
    cmd: [binaryPath, '--version'],
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      OMNIDRAW_HOME: tempConfigDir,
      OMNIDRAW_DISABLE_AUTOUPDATE: '1',
    },
  });

  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    proc.kill('SIGKILL');
  }, CANDIDATE_TIMEOUT_MS);

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited,
  ]).finally(() => clearTimeout(timeout));

  return { exitCode, stdout, stderr, timedOut };
}

async function validateCandidateBinary(binaryPath: string, tempConfigDir: string, version: string): Promise<void> {
  if (process.platform === 'darwin') {
    const signature = await runTextCommand(['codesign', '--verify', '--deep', '--strict', '--verbose=4', binaryPath]);
    if (signature.exitCode !== 0) {
      throw new Error(`Candidate has an invalid macOS signature: ${(signature.stderr || signature.stdout).trim()}`);
    }
  }

  const result = await executeCandidateBinary(binaryPath, tempConfigDir);
  if (result.timedOut) throw new Error(`Candidate startup timed out after ${CANDIDATE_TIMEOUT_MS / 1000}s`);
  if (result.exitCode !== 0) {
    throw new Error((result.stderr || result.stdout).trim() || `Candidate exited with status ${result.exitCode}`);
  }
  const reportedVersion = extractVersionFromTag(result.stdout.trim());
  const expectedVersion = extractVersionFromTag(version);
  if (reportedVersion !== expectedVersion) {
    throw new Error(`Candidate version mismatch: expected ${expectedVersion}, received ${reportedVersion || '<empty>'}`);
  }
}

async function dryRunUpgradeCandidate(args: { config: ICliConfig; version: string; onProgress?: (event: TUpgradeProgressEvent) => void }): Promise<TDryRunResult> {
  const releaseAsset = await buildReleaseAssetDescriptor();
  const tempRoot = mkdtempSync(join(tmpdir(), 'omnidraw-upgrade-dry-run-'));
  const archivePath = join(tempRoot, releaseAsset.archiveName);
  const checksumPath = join(tempRoot, releaseAsset.checksumName);
  const extractDir = join(tempRoot, 'extract');
  const tempConfigDir = join(tempRoot, 'config');
  const releaseTag = `omnidraw-v${extractVersionFromTag(args.version)}`;

  try {
    await downloadFile(`${RELEASE_DOWNLOAD_BASE}/${releaseTag}/${releaseAsset.checksumName}`, checksumPath, {
      onProgress: createDownloadProgressReporter(releaseAsset.checksumName, 70, 72, args.onProgress),
    });
    await downloadFile(`${RELEASE_DOWNLOAD_BASE}/${releaseTag}/${releaseAsset.archiveName}`, archivePath, {
      onProgress: createDownloadProgressReporter(releaseAsset.archiveName, 72, 84, args.onProgress),
    });

    args.onProgress?.({ percent: 86, label: 'Extracting archive' });
    await extractArchive(archivePath, extractDir, releaseAsset.isWindows);

    const binaryPath = findExtractedBinary(extractDir, releaseAsset.binaryName);
    args.onProgress?.({ percent: 88, label: 'Verifying candidate checksum' });
    await verifyFileChecksum(binaryPath, checksumPath);
    if (!releaseAsset.isWindows) {
      chmodSync(binaryPath, 0o755);
    }

    args.onProgress?.({ percent: 90, label: 'Preparing temporary config' });
    mkdirSync(tempConfigDir, { recursive: true });

    args.onProgress?.({ percent: 95, label: 'Running startup dry-run' });
    await validateCandidateBinary(binaryPath, tempConfigDir, args.version);

    return {
      ok: true,
      message: `Dry-run passed for ${releaseAsset.packageName}@${args.version}. Download, checksum, and startup all succeeded.`,
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

async function applyUpgrade(args: TApplyUpgradeArgs): Promise<TApplyUpgradeResult> {
  if (args.method !== 'curl') {
    const command = commandForMethod(args.method, args.version);
    return { ok: false, command, message: 'Auto-install is only enabled for curl installs' };
  }

  const tempRoot = mkdtempSync(join(tmpdir(), 'omnidraw-upgrade-'));
  try {
    const asset = await buildReleaseAssetDescriptor();
    const tag = `omnidraw-v${extractVersionFromTag(args.version)}`;
    const archivePath = join(tempRoot, asset.archiveName);
    const checksumPath = join(tempRoot, asset.checksumName);
    const extractDir = join(tempRoot, 'extract');
    await downloadFile(`${RELEASE_DOWNLOAD_BASE}/${tag}/${asset.checksumName}`, checksumPath, {
      onProgress: createDownloadProgressReporter(asset.checksumName, DOWNLOAD_PROGRESS_START, 86, args.onProgress),
    });
    await downloadFile(`${RELEASE_DOWNLOAD_BASE}/${tag}/${asset.archiveName}`, archivePath, {
      onProgress: createDownloadProgressReporter(asset.archiveName, 86, DOWNLOAD_PROGRESS_END, args.onProgress),
    });
    args.onProgress?.({ percent: 92, label: 'Extracting archive' });
    await extractArchive(archivePath, extractDir, asset.isWindows);
    const candidateBinary = findExtractedBinary(extractDir, asset.binaryName);
    await verifyFileChecksum(candidateBinary, checksumPath);
    if (!asset.isWindows) chmodSync(candidateBinary, 0o755);
    const candidateNative = join(extractDir, 'native');
    if (!existsSync(candidateNative)) throw new Error('Candidate archive is missing native addons');
    const tempConfigDir = join(tempRoot, 'config');
    mkdirSync(tempConfigDir, { recursive: true });
    args.onProgress?.({ percent: 95, label: 'Validating candidate' });
    await validateCandidateBinary(candidateBinary, tempConfigDir, args.version);

    const installedBinary = process.execPath;
    const installDir = join(installedBinary, '..');
    const nativeDir = join(installDir, '..', 'native');
    const backupBinary = `${installedBinary}.upgrade-backup`;
    const backupNative = `${nativeDir}.upgrade-backup`;
    rmSync(backupBinary, { force: true });
    rmSync(backupNative, { recursive: true, force: true });
    copyFileSync(installedBinary, backupBinary);
    if (existsSync(nativeDir)) cpSync(nativeDir, backupNative, { recursive: true });
    try {
      const stagedBinary = `${installedBinary}.upgrade-new`;
      const stagedNative = `${nativeDir}.upgrade-new`;
      copyFileSync(candidateBinary, stagedBinary);
      chmodSync(stagedBinary, 0o755);
      rmSync(stagedNative, { recursive: true, force: true });
      cpSync(candidateNative, stagedNative, { recursive: true });
      renameSync(stagedBinary, installedBinary);
      rmSync(nativeDir, { recursive: true, force: true });
      renameSync(stagedNative, nativeDir);
    } catch (error) {
      copyFileSync(backupBinary, installedBinary);
      rmSync(nativeDir, { recursive: true, force: true });
      if (existsSync(backupNative)) cpSync(backupNative, nativeDir, { recursive: true });
      throw error;
    } finally {
      rmSync(backupBinary, { force: true });
      rmSync(backupNative, { recursive: true, force: true });
    }
    args.onProgress?.({ percent: 98, label: 'Installed validated update' });
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

async function checkForUpgrade(args: TCheckForUpgradeArgs): Promise<TUpgradeResult> {
  args.onProgress?.({ percent: 10, label: 'Parsing options' });
  args.onProgress?.({ percent: 25, label: 'Resolving install method' });

  const method = args.methodOverride ?? detectInstallMethod();
  const policy = resolveUpdatePolicy(args.config, method);

  if (policy.mode === 'disabled' && !args.dryRun) {
    args.onProgress?.({ percent: 100, label: 'Done' });
    return { status: 'disabled', method, reason: policy.reason };
  }

  args.onProgress?.({ percent: 45, label: 'Checking latest version' });
  const latest = await fetchLatestVersion(args.targetVersionOverride);
  if (!latest) {
    args.onProgress?.({ percent: 100, label: 'Done' });
    return { status: 'error', method, message: 'Failed to fetch latest version' };
  }

  const currentVersion = getServerVersion(args.config);
  args.onProgress?.({ percent: 65, label: 'Evaluating upgrade decision' });
  const [decision, decisionErr] = fnCliUpdateShouldUpgrade({
    currentVersion,
    latestVersion: latest.version,
  });

  if (decisionErr || !decision) {
    args.onProgress?.({ percent: 100, label: 'Done' });
    return {
      status: 'error',
      method,
      message: decisionErr?.externalMessage?.en ?? 'Version check failed',
    };
  }

  if (!decision.shouldUpgrade) {
    args.onProgress?.({ percent: 100, label: 'Done' });
    return { status: 'up-to-date', version: currentVersion, method };
  }

  const manualCommand = commandForMethod(method, latest.version) ?? undefined;

  if (args.dryRun) {
    const dryRun = await dryRunUpgradeCandidate({
      config: args.config,
      version: latest.version,
      onProgress: args.onProgress,
    });

    args.onProgress?.({ percent: 100, label: 'Done' });
    if (dryRun.ok) {
      return {
        status: 'dry-run-ok',
        version: latest.version,
        method,
        message: dryRun.message,
      };
    }

    return {
      status: 'dry-run-failed',
      version: latest.version,
      method,
      message: dryRun.message,
      command: manualCommand,
    };
  }

  if (args.checkOnly || policy.mode === 'notify') {
    args.onProgress?.({ percent: 100, label: 'Done' });
    return {
      status: 'update-available',
      version: latest.version,
      method,
      command: manualCommand,
    };
  }

  const previousFailure = readFailedUpgrade(args.config);
  if (!args.targetVersionOverride && previousFailure?.version === latest.version) {
    args.onProgress?.({ percent: 100, label: 'Known-invalid update skipped' });
    return {
      status: 'update-available', version: latest.version, method, command: manualCommand,
      message: `Automatic retry skipped after previous validation failure: ${previousFailure.reason}`,
    };
  }

  const upgraded = await applyUpgrade({
    method,
    version: latest.version,
    channel: latest.channel,
    onProgress: args.onProgress,
  });

  if (!upgraded.ok) {
    await writeFailedUpgrade(args.config, { version: latest.version, reason: upgraded.message ?? 'candidate validation failed' });
    args.onProgress?.({ percent: 100, label: 'Done' });
    return {
      status: 'update-available',
      version: latest.version,
      method,
      command: upgraded.command ?? manualCommand,
      message: upgraded.message,
    };
  }

  await writeFailedUpgrade(args.config, null);

  args.onProgress?.({ percent: 100, label: 'Done' });
  return { status: 'updated', version: latest.version, method };
}

async function txCmdUpgrade(args: TRunUpgradeArgs): Promise<void> {
  const { values } = parseArgs({
    args: args.config.rawArgv,
    strict: false,
    allowPositionals: true,
    options: {
      check: {
        type: 'boolean',
        default: false,
      },
      'dry-run': {
        type: 'boolean',
        default: false,
      },
      method: {
        type: 'string',
      },
      'target-version': {
        type: 'string',
      },
      help: {
        type: 'boolean',
        short: 'h',
        default: false,
      },
    },
  });

  if (values.help) {
    printUpgradeHelp();
    process.exit(0);
  }

  const methodValue = values.method as string | undefined;
  const methodOverride = methodValue === 'curl' || methodValue === 'npm' || methodValue === 'unknown'
    ? methodValue
    : undefined;

  if (methodValue && !methodOverride) {
    console.error('[Update] Invalid --method. Allowed: curl, npm, unknown');
    process.exit(1);
  }

  const dryRun = Boolean(values['dry-run']);
  const progress = createUpgradeProgressRenderer();
  const result = await checkForUpgrade({
    config: args.config,
    checkOnly: Boolean(values.check),
    dryRun,
    methodOverride,
    targetVersionOverride: args.config.upgradeTarget ?? values['target-version'] as string | undefined,
    onProgress: progress.update,
  }).finally(() => {
    progress.finish();
  });
  const currentVersion = getServerVersion(args.config);

  if (result.status === 'updated') {
    console.log(`[Update] Current: v${currentVersion}`);
    console.log(`[Update] Method: ${result.method}`);
    console.log(`[Update] Updated to v${result.version}`);
    process.exit(0);
  }

  if (result.status === 'up-to-date') {
    console.log(`[Update] Current: v${currentVersion}`);
    console.log(`[Update] Latest:  v${result.version}`);
    console.log(`[Update] Method: ${result.method}`);
    console.log(`[Update] Already up to date (v${result.version})`);
    process.exit(0);
  }

  if (result.status === 'dry-run-ok') {
    console.log(`[Update] Current: v${currentVersion}`);
    console.log(`[Update] Latest:  v${result.version}`);
    console.log(`[Update] Method: ${result.method}`);
    console.log(`[Update] Dry-run: ${result.message}`);
    process.exit(0);
  }

  if (result.status === 'dry-run-failed') {
    console.log(`[Update] Current: v${currentVersion}`);
    console.log(`[Update] Latest:  v${result.version}`);
    console.log(`[Update] Method: ${result.method}`);
    console.error(`[Update] Dry-run failed: ${result.message}`);
    if (result.command) {
      console.log(`[Update] Manual fallback: ${result.command}`);
    }
    process.exit(1);
  }

  if (result.status === 'update-available') {
    console.log(`[Update] Current: v${currentVersion}`);
    console.log(`[Update] Latest:  v${result.version}`);
    console.log(`[Update] Method: ${result.method}`);
    if (values.check) {
      console.log('[Update] Check-only mode, no changes applied');
    }
    console.log(`[Update] New version available: v${result.version}`);
    if (result.message) console.error(`[Update] Candidate was not installed: ${result.message}`);
    if (result.command) {
      console.log(`[Update] Run: ${result.command}`);
    }
    process.exit(0);
  }

  if (result.status === 'disabled') {
    console.log(`[Update] Auto-update disabled (${result.reason})`);
    process.exit(0);
  }

  if (result.status === 'error') {
    console.error(`[Update] ${result.message}`);
    process.exit(1);
  }

  console.error('[Update] Unexpected upgrade state');
  process.exit(1);
}

export { checkForUpgrade, downloadFile, txCmdUpgrade };
