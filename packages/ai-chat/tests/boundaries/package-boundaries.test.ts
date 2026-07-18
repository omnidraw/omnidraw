import { readdirSync, readFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const PACKAGE_ROOT = process.cwd();
const WORKSPACE_ROOT = resolve(PACKAGE_ROOT, "../..");

function sourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return [".ts", ".tsx"].includes(extname(entry.name)) ? [path] : [];
  });
}

describe("package boundaries", () => {
  it("keeps canvas independent from AI Chat", () => {
    const violations = sourceFiles(join(WORKSPACE_ROOT, "packages/canvas/src")).flatMap((path) => {
      return readFileSync(path, "utf8").includes("@vibecanvas/ai-chat") ? [path] : [];
    });

    expect(violations).toEqual([]);
  });

  it("keeps frontend singletons, router hooks, and runtime globals behind injected ports", () => {
    const forbiddenImport = /from\s+["'](?:@\/|@solidjs\/router(?:[/'"]|$))/;
    const directRuntimeGlobal = /(?<![.\w])(?:window|document|crypto|console|navigator|fetch|FileReader|URL|Date|setTimeout|clearTimeout|setInterval|clearInterval|requestAnimationFrame|cancelAnimationFrame)\s*(?:\.|\()/;
    const violations = sourceFiles(join(PACKAGE_ROOT, "src")).flatMap((path) => {
      const source = readFileSync(path, "utf8");
      const isPortDeclaration = path.endsWith("/ports.ts");
      return forbiddenImport.test(source) || (!isPortDeclaration && directRuntimeGlobal.test(source)) ? [path] : [];
    });

    expect(violations).toEqual([]);
  });
});
