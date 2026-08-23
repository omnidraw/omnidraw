import { readFileSync, readdirSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const FORBIDDEN = [
  "@omnidraw/ui-ai-chat",
  "@omnidraw/orpc-client",
  "@omnidraw/service-db",
  "@omnidraw/service-theme",
  "@omnidraw/widget-contract",
  "@omnidraw/cangine",
  "@omnidraw/capsule",
  "@omnidraw/capsule-omnidraw",
  "@orpc/",
  "partysocket",
] as const;

function sourceFiles(directory: string): readonly string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return [".ts", ".tsx", ".css"].includes(extname(entry.name)) ? [path] : [];
  });
}

describe("frontend package boundaries", () => {
  it("uses only final public Omnidraw packages and the native Effect transport", () => {
    const frontendRoot = resolve(process.cwd());
    const componentRoot = resolve(frontendRoot, "../../packages/component-ai-chat");
    const files = [
      ...sourceFiles(join(frontendRoot, "src")),
      ...sourceFiles(join(componentRoot, "src")),
      join(frontendRoot, "package.json"),
      join(componentRoot, "package.json"),
    ];
    const violations = files.flatMap((path) => {
      const source = readFileSync(path, "utf8").toLowerCase();
      return FORBIDDEN.filter((value) => source.includes(value.toLowerCase()))
        .map((value) => `${path}: ${value}`);
    });

    expect(violations).toEqual([]);
  });

  it("does not add competing browser stream transports", () => {
    const source = sourceFiles(resolve(process.cwd(), "src"))
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");
    expect(source).not.toMatch(/\bEventSource\b/);
    expect(source).not.toMatch(/from\s+["']ws["']/);
    expect(source).toContain("Socket.WebSocketConstructor");
    expect(source).toContain('origin.pathname = "/rpc"');
  });

  it("keeps application source in core, shell, sim, and conformance", () => {
    const allowed = new Set(["core", "shell", "sim", "conformance", "index.tsx", "index.css"]);
    const entries = readdirSync(resolve(process.cwd(), "src"));
    expect(entries.filter((entry) => !allowed.has(entry))).toEqual([]);
  });
});
