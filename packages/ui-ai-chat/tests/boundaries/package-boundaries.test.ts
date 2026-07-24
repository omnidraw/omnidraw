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
      return readFileSync(path, "utf8").includes("@vibecanvas/ui-ai-chat") ? [path] : [];
    });

    expect(violations).toEqual([]);
  });

  it("keeps retired resident runtime ownership out of AI Chat", () => {
    const forbiddenDependency = /@vibecanvas\/(?:service-actor|ui-actor-legacy)(?:[/'"]|$)/;
    const forbiddenActorTransport = /\bapi\.actors\b|\bactors\s*:/;
    const packageSource = readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8");
    const violations = sourceFiles(join(PACKAGE_ROOT, "src")).flatMap((path) => {
      const source = readFileSync(path, "utf8");
      return forbiddenDependency.test(source) || forbiddenActorTransport.test(source) ? [path] : [];
    });

    expect(forbiddenDependency.test(packageSource)).toBe(false);
    expect(violations).toEqual([]);
  });

  it("keeps renderer-neutral widget data helpers in canvas", () => {
    const widgetHostRoot = join(WORKSPACE_ROOT, "packages/canvas/src/widget-host");
    const implementationFiles = [
      "CONSTANTS.ts",
      "types.ts",
      "fn.create-cloned-widget-element.ts",
      "fn.create-widget-element.ts",
      "fn.normalize-widget-host-data.ts",
    ];
    const compatibilityFiles = [
      "fn.create-cloned-widget-element.ts",
      "fn.create-widget-element.ts",
      "fn.normalize-widget-host-data.ts",
    ];
    const forbiddenCanvasDependency = /@vibecanvas\/(?:api(?:[-/]|(?=["']|$))|service-actor|ui-ai-chat)/;
    const violations = sourceFiles(widgetHostRoot).flatMap((path) => {
      return forbiddenCanvasDependency.test(readFileSync(path, "utf8")) ? [path] : [];
    });
    const invalidCompatibilityExports = compatibilityFiles.flatMap((file) => {
      const path = join(PACKAGE_ROOT, "src/widget", file);
      const source = readFileSync(path, "utf8");
      const lines = source.split("\n").map((line) => line.trim()).filter(Boolean);
      return source.includes("@vibecanvas/canvas/widget-host/")
        && lines.length <= 2
        && lines.every((line) => line.startsWith("export "))
        ? []
        : [path];
    });

    expect(sourceFiles(widgetHostRoot).map((path) => path.slice(widgetHostRoot.length + 1)).sort()).toEqual(
      [...implementationFiles].sort(),
    );
    expect(forbiddenCanvasDependency.test("@vibecanvas/api")).toBe(true);
    expect(forbiddenCanvasDependency.test("@vibecanvas/api/actor/contract")).toBe(true);
    expect(forbiddenCanvasDependency.test(["@vibecanvas/api", "-actors/contract"].join(""))).toBe(true);
    expect(violations).toEqual([]);
    expect(invalidCompatibilityExports).toEqual([]);
  });

  it("keeps renderer objects out of AI widget and draft integrations", () => {
    const ownedRoots = [
      join(PACKAGE_ROOT, "src/widget"),
      join(PACKAGE_ROOT, "src/canvas-extension"),
      join(PACKAGE_ROOT, "src/draft-preview"),
      join(PACKAGE_ROOT, "src/widget-placement"),
    ];
    const forbidden = /\bKonva\b|from\s+["']konva|staticForegroundLayer|createNodeFromElement/;
    const violations = ownedRoots.flatMap(sourceFiles).filter((path) => {
      return forbidden.test(readFileSync(path, "utf8"));
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

  it("uses Capsule only through the Vibecanvas browser adapter and contains no Arrow runtime", () => {
    const source = sourceFiles(join(PACKAGE_ROOT, "src"))
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");
    const packageSource = readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8");

    expect(source).not.toMatch(/from\s+["']@omnidraw\/capsule(?:[/'"]|$)/);
    expect(source).not.toMatch(/@arrow-js|widget-artifact\.v1|__VIBECANVAS_.*TRANSPORT/);
    expect(packageSource).not.toContain("@arrow-js/");
    expect(packageSource).toContain("@vibecanvas/capsule-vibecanvas");
  });
});
