import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyAndSealInspectionDist } from "./inspection-dist";

describe("inspection distribution verifier", () => {
  let root: string;

  afterEach(async () => {
    if (root !== undefined) await rm(root, { recursive: true, force: true });
  });

  async function fixture(args: Readonly<{
    reference?: string;
    loader?: string;
  }> = {}): Promise<void> {
    root = await mkdtemp(join(tmpdir(), "omnidraw-inspection-dist-test-"));
    await mkdir(join(root, "assets"));
    await writeFile(join(root, "index.html"), `<!doctype html><script type="module" src="${args.reference ?? "./assets/main.js"}"></script>`);
    await writeFile(join(root, "assets", "main.js"), "globalThis.shell = true;");
    await writeFile(
      join(root, "assets", "loader.js"),
      args.loader ?? "const q={importFFI:true,importModuleLoader:true};export{q as default}",
    );
  }

  test("seals and then revalidates the exact complete distribution", async () => {
    await fixture();
    const first = await verifyAndSealInspectionDist(root);
    const second = await verifyAndSealInspectionDist(root);
    expect(second).toEqual(first);
    await writeFile(join(root, "assets", "unexpected.js"), "partial");
    await expect(verifyAndSealInspectionDist(root)).rejects.toThrow("receipt does not match");
  });

  test.each([
    ["absolute", "/assets/main.js", "token-relative"],
    ["escaping", "../outside.js", "escapes its private root"],
    ["missing", "./assets/missing.js", "asset is missing"],
  ])("rejects %s entry references", async (_name, reference, message) => {
    await fixture({ reference });
    await expect(verifyAndSealInspectionDist(root)).rejects.toThrow(message);
  });

  test("rejects top-level-await wrapper and QuickJS namespace drift", async () => {
    await fixture({ loader: "const q={importFFI:true,importModuleLoader:true};const __tla=1;export{q as default}" });
    await expect(verifyAndSealInspectionDist(root)).rejects.toThrow("top-level-await wrapper");
    await rm(root, { recursive: true, force: true });
    await fixture({ loader: "const q={importFFI:true,importModuleLoader:true},x=1;export{q as default,x}" });
    await expect(verifyAndSealInspectionDist(root)).rejects.toThrow("exactly one default export");
  });
});
