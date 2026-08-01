#!/usr/bin/env bun

import { rmSync } from "node:fs";
import path from "node:path";
import { BUILTIN_THEMES } from "../src/builtins";
import { fxGetThemeCssVariables } from "../src/dom";

const packageDirectory = path.join(import.meta.dir, "..");
const outputDirectory = path.join(packageDirectory, "dist");

rmSync(outputDirectory, { recursive: true, force: true });

const typescriptPackagePath = Bun.resolveSync(
  "typescript/package.json",
  path.join(packageDirectory, "package.json"),
);
const tscPath = path.join(path.dirname(typescriptPackagePath), "bin", "tsc");
const result = Bun.spawnSync({
  cmd: ["bun", tscPath, "-p", "tsconfig.build.json"],
  cwd: packageDirectory,
  stdout: "inherit",
  stderr: "inherit",
});

if (result.exitCode !== 0) {
  process.exit(result.exitCode);
}

const defaultTheme = BUILTIN_THEMES[0];
const declarations = Object.entries(fxGetThemeCssVariables(defaultTheme))
  .map(([name, value]) => `  ${name}: ${value};`)
  .join("\n");
const rule = (selector: string) => [
  `${selector} {`,
  `  color-scheme: ${defaultTheme.appearance};`,
  declarations,
  "}",
  "",
].join("\n");
await Bun.write(path.join(outputDirectory, "default.css"), rule(":root"));
await Bun.write(
  path.join(outputDirectory, "canvas-default.css"),
  rule(".vc-canvas-host"),
);
