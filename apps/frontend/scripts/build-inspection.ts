#!/usr/bin/env bun

import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath, rm } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { build } from "vite";
import {
  INSPECTION_BUILD_SOURCE_FILE,
  INSPECTION_BUILD_SOURCE_FORMAT,
  publishInspectionStaging,
} from "./inspection-build-publisher";
import { verifyAndSealInspectionDist } from "./inspection-dist";
import type { TInspectionDistReceipt } from "./inspection-dist";

const frontendRoot = resolve(import.meta.dir, "..");
const watch = process.argv.includes("--watch");
const reuseCurrent = process.argv.includes("--reuse-current");
const configuredDist = process.argv.find((value) => value.startsWith("--dist-root="))
  ?.slice("--dist-root=".length);
const additionalWatchRoot = process.argv.find((value) => value.startsWith("--watch-root="))
  ?.slice("--watch-root=".length);
const distRoot = resolve(configuredDist ?? join(frontendRoot, "dist"));
const buildsRoot = join(distRoot, ".inspection-builds");
const publicPath = join(distRoot, "inspection");
const stagingPath = join(distRoot, `.inspection-staging-${process.pid}`);
let stopping = false;
let requestedExitCode = 0;

async function publishStaging(
  sourceFingerprint: `sha256:${string}`,
): Promise<TInspectionDistReceipt> {
  return publishInspectionStaging({ stagingPath, distRoot, sourceFingerprint });
}

async function verifyCurrentBuild(): Promise<`sha256:${string}`> {
  const publicEntry = await lstat(publicPath).catch(() => null);
  if (publicEntry === null || !publicEntry.isSymbolicLink()) {
    throw new Error("Verified inspection-shell prerequisite is absent; run build:inspection first.");
  }
  const buildPath = await realpath(publicPath);
  const nested = relative(await realpath(buildsRoot), buildPath);
  if (
    nested === ""
    || nested.startsWith(`..${sep}`)
    || nested.includes(sep)
    || !/^[a-f0-9]{64}$/u.test(nested)
  ) {
    throw new Error("Inspection-shell prerequisite does not resolve to an immutable build identity.");
  }
  const receipt = await verifyAndSealInspectionDist(buildPath);
  if (nested !== receipt.buildId.slice("sha256:".length)) {
    throw new Error("Inspection-shell prerequisite path does not match its verified build identity.");
  }
  const evidence = await readFile(join(buildPath, INSPECTION_BUILD_SOURCE_FILE), "utf8")
    .then((value) => JSON.parse(value) as unknown)
    .catch(() => null);
  if (
    evidence === null
    || typeof evidence !== "object"
    || !("format" in evidence)
    || evidence.format !== INSPECTION_BUILD_SOURCE_FORMAT
    || !("sourceFingerprint" in evidence)
    || typeof evidence.sourceFingerprint !== "string"
    || !/^sha256:[a-f0-9]{64}$/u.test(evidence.sourceFingerprint)
  ) throw new Error("Inspection-shell prerequisite has no trustworthy source fingerprint.");
  return evidence.sourceFingerprint as `sha256:${string}`;
}

async function sourceFingerprint(): Promise<`sha256:${string}`> {
  const roots = [
    join(frontendRoot, "inspection"),
    join(frontendRoot, "src", "shell", "inspection"),
    join(frontendRoot, "vite.inspection.config.ts"),
    resolve(frontendRoot, "..", "..", "packages", "sdk", "src"),
    ...(additionalWatchRoot === undefined ? [] : [resolve(additionalWatchRoot)]),
  ];
  const files: Array<Readonly<{ key: string; path: string }>> = [];
  const pending = roots.map((path, index) => ({ key: String(index), path }));
  while (pending.length > 0) {
    const { key, path } = pending.pop()!;
    const entry = await lstat(path).catch(() => null);
    if (entry === null) continue;
    if (entry.isDirectory()) {
      for (const child of await readdir(path).catch(() => [])) {
        pending.push({ key: `${key}/${child}`, path: join(path, child) });
      }
    } else if (entry.isFile()) {
      files.push({ key, path });
    }
  }
  const hash = createHash("sha256");
  for (const { key, path } of files.sort((left, right) => left.key.localeCompare(right.key))) {
    hash.update(key);
    hash.update("\0");
    hash.update(await readFile(path).catch(() => new TextEncoder().encode("<source-disappeared>")));
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}

async function runBuild(): Promise<`sha256:${string}`> {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const before = await sourceFingerprint();
    await rm(stagingPath, { recursive: true, force: true });
    await build({
      configFile: join(frontendRoot, "vite.inspection.config.ts"),
      build: { outDir: stagingPath, emptyOutDir: true, watch: null },
    });
    const after = await sourceFingerprint();
    if (before !== after) {
      console.warn(`[inspection-shell] sources changed during build; retrying stable build (${attempt}/5)`);
      continue;
    }
    const receipt = await publishStaging(after);
    if (await sourceFingerprint() === after) {
      console.log(`[inspection-shell] ready ${receipt.buildId} (${watch ? "watching; last verified build stays active on rebuild failure" : "verified"})`);
      return after;
    }
    console.warn(`[inspection-shell] sources changed before readiness; rebuilding immediately (${attempt}/5)`);
  }
  throw new Error("Preview inspection sources did not remain stable long enough to publish readiness.");
}

process.on("SIGINT", () => { stopping = true; requestedExitCode = 130; });
process.on("SIGTERM", () => { stopping = true; requestedExitCode = 143; });

await mkdir(buildsRoot, { recursive: true });
let fingerprint: `sha256:${string}`;
if (reuseCurrent) {
  const builtFingerprint = await verifyCurrentBuild();
  const currentFingerprint = await sourceFingerprint();
  if (builtFingerprint === currentFingerprint) {
    fingerprint = currentFingerprint;
    const receipt = await verifyAndSealInspectionDist(publicPath);
    console.log(`[inspection-shell] ready ${receipt.buildId} (watching verified prerequisite; last verified build stays active on rebuild failure)`);
  } else fingerprint = await runBuild();
} else fingerprint = await runBuild();

if (watch) {
  while (!stopping) {
    await Bun.sleep(350);
    if (stopping) break;
    const next = await sourceFingerprint();
    if (next === fingerprint) continue;
    try {
      fingerprint = await runBuild();
    } catch (error) {
      console.error("[inspection-shell] rebuild failed; retaining the last verified distribution");
      console.error(error);
    }
  }
}

await rm(stagingPath, { recursive: true, force: true });
if (requestedExitCode !== 0) process.exit(requestedExitCode);
