import { createHash } from "node:crypto";
import { lstat, readFile, readdir, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

export const INSPECTION_DIST_RECEIPT = ".omnidraw-inspection-dist.json";
export const INSPECTION_DIST_FORMAT = "omnidraw.preview-inspection-dist.v1";

export type TInspectionDistReceipt = Readonly<{
  format: typeof INSPECTION_DIST_FORMAT;
  buildId: `sha256:${string}`;
  files: readonly Readonly<{
    path: string;
    bytes: number;
    sha256: string;
  }>[];
}>;

function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function distributionFiles(root: string): Promise<string[]> {
  const pending = [root];
  const files: string[] = [];
  while (pending.length > 0) {
    const directory = pending.pop()!;
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = resolve(directory, entry.name);
      const nested = relative(root, absolute).split(sep).join("/");
      if (nested === INSPECTION_DIST_RECEIPT) continue;
      if (entry.isSymbolicLink()) {
        throw new Error(`Preview inspection distribution contains a symbolic link: ${nested}`);
      }
      if (entry.isDirectory()) pending.push(absolute);
      else if (entry.isFile()) files.push(nested);
      else throw new Error(`Preview inspection distribution contains a special file: ${nested}`);
    }
  }
  return files.sort();
}

export async function verifyAndSealInspectionDist(
  shellRoot: string,
): Promise<TInspectionDistReceipt> {
  const root = resolve(shellRoot);
  const entryPath = resolve(root, "index.html");
  const entryStat = await lstat(entryPath).catch(() => null);
  if (entryStat === null || !entryStat.isFile() || entryStat.isSymbolicLink()) {
    throw new Error("Preview inspection build did not emit index.html.");
  }
  const html = await readFile(entryPath, "utf8");
  const references = [...html.matchAll(/\b(?:src|href)="([^"]+)"/g)]
    .map((match) => match[1]!)
    .filter((value) => !value.startsWith("data:") && !value.startsWith("#"));

  if (references.length === 0 || !references.some((value) => value.endsWith(".js"))) {
    throw new Error("Preview inspection build did not emit an executable shell entry.");
  }

  for (const reference of references) {
    if (isAbsolute(reference) || reference.startsWith("//") || /^[a-z]+:/i.test(reference)) {
      throw new Error(`Preview inspection asset must be token-relative: ${reference}`);
    }
    const target = resolve(root, reference.split(/[?#]/, 1)[0]!);
    const nested = relative(root, target);
    if (nested === ".." || nested.startsWith(`..${sep}`) || isAbsolute(nested)) {
      throw new Error(`Preview inspection asset escapes its private root: ${reference}`);
    }
    const targetStat = await lstat(target).catch(() => null);
    if (targetStat === null || !targetStat.isFile() || targetStat.isSymbolicLink()) {
      throw new Error(`Preview inspection asset is missing: ${reference}`);
    }
  }

  const paths = await distributionFiles(root);
  const fileEntries = await Promise.all(paths.map(async (path) => {
    const bytes = await readFile(resolve(root, path));
    return Object.freeze({ path, bytes: bytes.byteLength, sha256: sha256(bytes) });
  }));
  const javascript = await Promise.all(fileEntries
    .filter(({ path }) => path.endsWith(".js"))
    .map(async ({ path }) => ({ path, source: await readFile(resolve(root, path), "utf8") })));
  if (javascript.some(({ source }) => /\b__tla\b/u.test(source))) {
    throw new Error("Preview inspection assets contain top-level-await wrapper exports.");
  }

  const quickJsLoaders = javascript.filter(({ source }) => (
    source.length < 4_096
    && source.includes("importFFI")
    && source.includes("importModuleLoader")
  ));
  if (quickJsLoaders.length !== 1) {
    throw new Error(`Expected one QuickJS loader chunk, found ${quickJsLoaders.length}.`);
  }
  const exports = [...quickJsLoaders[0]!.source.matchAll(/export\{([^}]*)\}/gu)]
    .flatMap((match) => match[1]!.split(",").map((value) => value.trim()))
    .filter(Boolean);
  if (exports.length !== 1 || !/^[A-Za-z_$][A-Za-z0-9_$]*\s+as\s+default$/u.test(exports[0]!)) {
    throw new Error("QuickJS loader chunk must expose exactly one default export.");
  }

  const identitySource = JSON.stringify(fileEntries);
  const receipt = Object.freeze({
    format: INSPECTION_DIST_FORMAT,
    buildId: `sha256:${sha256(identitySource)}` as const,
    files: Object.freeze(fileEntries),
  });
  const receiptPath = resolve(root, INSPECTION_DIST_RECEIPT);
  const existing = await readFile(receiptPath, "utf8").catch(() => null);
  if (existing !== null) {
    let parsed: unknown;
    try { parsed = JSON.parse(existing); } catch { parsed = null; }
    if (JSON.stringify(parsed) !== JSON.stringify(receipt)) {
      throw new Error("Preview inspection distribution receipt does not match its exact files.");
    }
  } else {
    await writeFile(
      receiptPath,
      `${JSON.stringify(receipt, null, 2)}\n`,
      { flag: "wx", mode: 0o600 },
    );
  }
  return receipt;
}
