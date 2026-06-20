/**
 * @file Updates root, app, and package package.json versions to a validated release version.
 */

import { join } from "path";
import { readdirSync, existsSync, statSync } from "fs";

const newVersion = process.argv[2];

if (!newVersion) {
  console.error("Usage: bun scripts/update-version.ts <new-version>");
  process.exit(1);
}

function isValidVersion(version: string): boolean {
  const stablePattern = /^\d+\.\d+\.\d+$/;
  const betaPattern = /^\d+\.\d+\.\d+-beta\.\d+$/;
  const nightlyPattern = /^\d+\.\d+\.\d+-nightly\.(\d+|\d{8})$/;

  return stablePattern.test(version) || betaPattern.test(version) || nightlyPattern.test(version);
}

if (!isValidVersion(newVersion)) {
  console.error(`Invalid version: ${newVersion}`);
  console.error("Allowed formats:");
  console.error("- stable:  0.3.0");
  console.error("- beta:    0.3.0-beta.1");
  console.error("- nightly: 0.3.0-nightly.20260409");
  process.exit(1);
}

const rootDir = join(import.meta.dir, "..");
const dirsToScan = ["apps", "packages"];

const targetDirs = [rootDir];

for (const scanDir of dirsToScan) {
  const fullPath = join(rootDir, scanDir);
  if (existsSync(fullPath)) {
    for (const entry of readdirSync(fullPath)) {
      if (entry.startsWith(".")) continue;
      const entryPath = join(fullPath, entry);
      if (statSync(entryPath).isDirectory()) {
        targetDirs.push(entryPath);
      }
    }
  }
}

for (const dir of targetDirs) {
  const pkgPath = join(dir, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const file = Bun.file(pkgPath);
      const pkg = await file.json();
      const oldVersion = pkg.version;
      pkg.version = newVersion;
      await Bun.write(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
      console.log(`Updated ${pkgPath.replace(rootDir, ".")} : ${oldVersion || 'undefined'} -> ${newVersion}`);
    } catch (e) {
      console.error(`Error updating ${pkgPath}:`, e);
    }
  }
}
