#!/usr/bin/env bun

import { readFile, readdir, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

const shellRoot = resolve(import.meta.dir, "..", "dist", "inspection");
const entryPath = resolve(shellRoot, "index.html");
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
  const target = resolve(shellRoot, reference.split(/[?#]/, 1)[0]!);
  const nested = relative(shellRoot, target);
  if (nested === ".." || nested.startsWith(`..${sep}`) || isAbsolute(nested)) {
    throw new Error(`Preview inspection asset escapes its private root: ${reference}`);
  }
  const targetStat = await stat(target).catch(() => null);
  if (targetStat === null || !targetStat.isFile()) {
    throw new Error(`Preview inspection asset is missing: ${reference}`);
  }
}

const assetFiles = (await readdir(resolve(shellRoot, "assets"), {
  recursive: true,
  withFileTypes: true,
}))
  .filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
  .map((entry) => resolve(entry.parentPath, entry.name));
const javascript = await Promise.all(assetFiles.map(async (path) => ({
  path,
  source: await readFile(path, "utf8"),
})));
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

console.log(`[inspection-dist] verified index.html, ${references.length} token-relative assets, and the QuickJS loader module shape`);
