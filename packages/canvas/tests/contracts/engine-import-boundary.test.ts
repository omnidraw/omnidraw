import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { describe, expect, test } from "vitest";

const SOURCE_ROOT = resolve(process.cwd(), "src");
const ENGINE_ROOT = join(SOURCE_ROOT, "engine");
const ENGINE_PACKAGE = "@vibecanvas/canvas-engine";

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const child = join(directory, entry.name);
      if (entry.isDirectory()) {
        return sourceFiles(child);
      }

      return [child];
    })
    .filter((file) => [".ts", ".tsx"].includes(extname(file)));
}

describe("canvas-engine import boundary", () => {
  test("runtime package imports stay inside src/engine", () => {
    const violations = sourceFiles(SOURCE_ROOT)
      .filter((file) => {
        const source = readFileSync(file, "utf8");
        return source.includes(ENGINE_PACKAGE)
          && !file.startsWith(ENGINE_ROOT);
      })
      .map((file) => relative(SOURCE_ROOT, file))
      .sort();

    expect(violations).toEqual([]);
  });

  test("does not deep-import unpublished engine internals", () => {
    const deepImportPattern = /@vibecanvas\/canvas-engine\/(?!types(?:["'])|geometry(?:["'])|testing(?:["'])|backend(?:["'])|package\.json(?:["']))/;
    const violations = sourceFiles(ENGINE_ROOT)
      .flatMap((file) => {
        const source = readFileSync(file, "utf8");
        return deepImportPattern.test(source)
          ? [join("src/engine", relative(ENGINE_ROOT, file))]
          : [];
      })
      .sort();

    expect(violations).toEqual([]);
  });
});
