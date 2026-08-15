import { randomUUID } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import {
  verifyAndSealInspectionDist,
  type TInspectionDistReceipt,
} from "./inspection-dist";

/**
 * A backend lease is bounded by the 180 second inspection timeout plus its
 * five second cleanup budget. Keeping retired builds for fifteen minutes
 * leaves a deliberately wide safety margin for scheduling and late cleanup.
 */
export const INSPECTION_BUILD_RETIREMENT_GRACE_MS = 15 * 60 * 1_000;
export const INSPECTION_BUILD_RECENT_RETENTION = 4;
export const INSPECTION_BUILD_SOURCE_FORMAT = "omnidraw.preview-inspection-source.v1";
export const INSPECTION_BUILD_SOURCE_FILE = ".omnidraw-inspection-source.json";

async function writeRetirementMarker(
  retirementsRoot: string,
  identity: string,
  unpublishedAtMs: number,
): Promise<void> {
  const markerPath = join(retirementsRoot, `${identity}.json`);
  const temporaryMarker = `${markerPath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporaryMarker, `${JSON.stringify({ unpublishedAtMs })}\n`, { mode: 0o600 });
  try {
    await rename(temporaryMarker, markerPath);
  } finally {
    await rm(temporaryMarker, { force: true });
  }
}

type TRetireInspectionBuildsArgs = Readonly<{
  buildsRoot: string;
  currentBuildPath: string;
  retirementsRoot?: string;
  nowMs?: number;
  graceMs?: number;
  retainRecent?: number;
}>;

export async function retireInspectionBuilds(
  args: TRetireInspectionBuildsArgs,
): Promise<readonly string[]> {
  const buildsRoot = await realpath(resolve(args.buildsRoot));
  const currentBuildPath = await realpath(resolve(args.currentBuildPath));
  const retirementsRoot = resolve(args.retirementsRoot ?? join(dirname(buildsRoot), ".inspection-retirements"));
  const nowMs = args.nowMs ?? Date.now();
  const graceMs = args.graceMs ?? INSPECTION_BUILD_RETIREMENT_GRACE_MS;
  const retainRecent = args.retainRecent ?? INSPECTION_BUILD_RECENT_RETENTION;
  if (!Number.isFinite(graceMs) || graceMs < 0 || !Number.isSafeInteger(retainRecent) || retainRecent < 1) {
    throw new TypeError("Inspection build retirement policy is invalid.");
  }

  await mkdir(retirementsRoot, { recursive: true });
  const candidates = await Promise.all((await readdir(buildsRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && /^[a-f0-9]{64}$/u.test(entry.name))
    .map(async (entry) => {
      const path = join(buildsRoot, entry.name);
      const markerPath = join(retirementsRoot, `${entry.name}.json`);
      const retirement = await readFile(join(retirementsRoot, `${entry.name}.json`), "utf8")
        .then((value) => JSON.parse(value) as unknown)
        .catch(() => null);
      let unpublishedAtMs = retirement !== null
        && typeof retirement === "object"
        && "unpublishedAtMs" in retirement
        && typeof retirement.unpublishedAtMs === "number"
        && Number.isFinite(retirement.unpublishedAtMs)
        ? retirement.unpublishedAtMs
        : null;
      if (path === currentBuildPath) {
        await rm(markerPath, { force: true });
        unpublishedAtMs = null;
      } else if (unpublishedAtMs === null) {
        // Builds from before this marker scheme, and crash-orphans left after
        // a symlink swap, get a full fail-safe grace period from discovery.
        unpublishedAtMs = nowMs;
        await writeRetirementMarker(retirementsRoot, entry.name, unpublishedAtMs);
      }
      return { name: entry.name, path, unpublishedAtMs };
    }));
  candidates.sort((left, right) => (
    (right.unpublishedAtMs ?? Number.POSITIVE_INFINITY)
      - (left.unpublishedAtMs ?? Number.POSITIVE_INFINITY)
    || right.name.localeCompare(left.name)
  ));

  const retained = new Set(candidates.slice(0, retainRecent).map(({ path }) => path));
  retained.add(currentBuildPath);
  const removed: string[] = [];
  for (const candidate of candidates) {
    if (
      retained.has(candidate.path)
      || candidate.unpublishedAtMs === null
      || nowMs - candidate.unpublishedAtMs <= graceMs
    ) continue;
    await rm(candidate.path, { recursive: true, force: true });
    await rm(join(retirementsRoot, `${candidate.name}.json`), { force: true });
    removed.push(candidate.name);
  }
  return Object.freeze(removed);
}

async function pointToBuild(args: Readonly<{
  distRoot: string;
  publicPath: string;
  buildPath: string;
}>): Promise<void> {
  const temporaryLink = await mkdtemp(join(args.distRoot, ".inspection-link-"));
  await rm(temporaryLink, { recursive: true, force: true });
  await symlink(relative(dirname(args.publicPath), args.buildPath), temporaryLink, "dir");
  const current = await lstat(args.publicPath).catch(() => null);
  if (current !== null && !current.isSymbolicLink()) {
    const legacy = join(args.distRoot, `.inspection-replaced-${process.pid}`);
    await rm(legacy, { recursive: true, force: true });
    await rename(args.publicPath, legacy);
    try {
      await rename(temporaryLink, args.publicPath);
    } finally {
      await rm(legacy, { recursive: true, force: true });
      await rm(temporaryLink, { force: true });
    }
    return;
  }
  await rename(temporaryLink, args.publicPath);
}

export async function publishInspectionStaging(args: Readonly<{
  stagingPath: string;
  distRoot: string;
  sourceFingerprint: `sha256:${string}`;
  nowMs?: number;
}>): Promise<TInspectionDistReceipt> {
  const distRoot = resolve(args.distRoot);
  const stagingPath = resolve(args.stagingPath);
  const buildsRoot = join(distRoot, ".inspection-builds");
  const retirementsRoot = join(distRoot, ".inspection-retirements");
  const publicPath = join(distRoot, "inspection");
  if (!/^sha256:[a-f0-9]{64}$/u.test(args.sourceFingerprint)) {
    throw new TypeError("Inspection build source fingerprint is invalid.");
  }
  await writeFile(join(stagingPath, INSPECTION_BUILD_SOURCE_FILE), `${JSON.stringify({
    format: INSPECTION_BUILD_SOURCE_FORMAT,
    sourceFingerprint: args.sourceFingerprint,
  })}\n`, { flag: "wx", mode: 0o600 });
  const receipt = await verifyAndSealInspectionDist(stagingPath);
  const buildPath = join(buildsRoot, receipt.buildId.slice("sha256:".length));
  const existing = await lstat(buildPath).catch(() => null);
  if (existing === null) await rename(stagingPath, buildPath);
  else {
    if (!existing.isDirectory() || existing.isSymbolicLink()) {
      throw new Error(`Inspection build identity is not a directory: ${receipt.buildId}`);
    }
    await verifyAndSealInspectionDist(buildPath);
    await rm(stagingPath, { recursive: true, force: true });
  }
  const previousBuildPath = await realpath(publicPath).catch(() => null);
  await pointToBuild({ distRoot, publicPath, buildPath });
  const pinnedBuildPath = await realpath(publicPath);
  const expectedBuildPath = await realpath(buildPath);
  if (pinnedBuildPath !== expectedBuildPath) {
    throw new Error("Published inspection distribution did not resolve to its verified build identity.");
  }
  await mkdir(retirementsRoot, { recursive: true });
  const currentIdentity = receipt.buildId.slice("sha256:".length);
  await rm(join(retirementsRoot, `${currentIdentity}.json`), { force: true });
  if (
    previousBuildPath !== null
    && previousBuildPath !== pinnedBuildPath
    && dirname(previousBuildPath) === await realpath(buildsRoot)
  ) {
    const previousIdentity = basename(previousBuildPath);
    if (/^[a-f0-9]{64}$/u.test(previousIdentity)) {
      await writeRetirementMarker(
        retirementsRoot,
        previousIdentity,
        args.nowMs ?? Date.now(),
      );
    }
  }
  await retireInspectionBuilds({
    buildsRoot,
    currentBuildPath: pinnedBuildPath,
    retirementsRoot,
    nowMs: args.nowMs,
  });
  return receipt;
}
