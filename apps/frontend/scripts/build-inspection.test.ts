import { afterEach, describe, expect, test } from "bun:test";
import { lstat, mkdir, mkdtemp, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  INSPECTION_BUILD_RETIREMENT_GRACE_MS,
  publishInspectionStaging,
  retireInspectionBuilds,
} from "./inspection-build-publisher";
import { verifyAndSealInspectionDist } from "./inspection-dist";

describe("verified inspection-shell development builder", () => {
  let root: string | undefined;
  let child: ReturnType<typeof Bun.spawn> | undefined;

  afterEach(async () => {
    child?.kill("SIGTERM");
    if (child !== undefined) await child.exited.catch(() => undefined);
    if (root !== undefined) await rm(root, { recursive: true, force: true });
  });

  test("establishes a clean output before readiness, rebuilds, and cleans staging on shutdown", async () => {
    root = await mkdtemp(join(tmpdir(), "omnidraw-inspection-dev-test-"));
    const distRoot = join(root, "dist");
    const watchRoot = join(root, "watch-source");
    await writeFile(watchRoot, "initial", { flag: "wx" });
    child = Bun.spawn({
      cmd: [
        process.execPath,
        "run",
        "scripts/build-inspection.ts",
        "--watch",
        `--dist-root=${distRoot}`,
        `--watch-root=${watchRoot}`,
      ],
      cwd: resolve(import.meta.dir, ".."),
      env: process.env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = child.stdout;
    const stderr = child.stderr;
    if (!(stdout instanceof ReadableStream) || !(stderr instanceof ReadableStream)) {
      throw new Error("Inspection builder test could not capture child output.");
    }
    let output = "";
    let errors = "";
    const stdoutReader = stdout.getReader();
    const stderrReader = stderr.getReader();
    const readOutput = async (): Promise<void> => {
      while (true) {
        const result = await stdoutReader.read();
        if (result.done) return;
        output += new TextDecoder().decode(result.value);
      }
    };
    const readErrors = async (): Promise<void> => {
      while (true) {
        const result = await stderrReader.read();
        if (result.done) return;
        errors += new TextDecoder().decode(result.value);
      }
    };
    void readOutput();
    void readErrors();
    const waitForReadyCount = async (count: number): Promise<void> => {
      const deadline = Date.now() + 30_000;
      while ((output.match(/\[inspection-shell\] ready/g) ?? []).length < count) {
        if (Date.now() >= deadline) throw new Error(`Timed out waiting for inspection readiness.\n${output}\n${errors}`);
        if (child?.exitCode !== null) throw new Error(`Inspection builder exited early.\n${output}\n${errors}`);
        await Bun.sleep(25);
      }
    };

    await waitForReadyCount(1);
    const publicPath = join(distRoot, "inspection");
    expect((await lstat(publicPath)).isSymbolicLink()).toBe(true);
    const first = await verifyAndSealInspectionDist(publicPath);

    await writeFile(watchRoot, "changed output trigger");
    await waitForReadyCount(2);
    const second = await verifyAndSealInspectionDist(publicPath);
    expect(second.buildId).not.toBe(first.buildId);

    child.kill("SIGTERM");
    expect(await child.exited).toBe(143);
    child = undefined;
    expect((await readdir(distRoot)).some((name) => name.startsWith(".inspection-staging-"))).toBe(false);
  }, 60_000);

  test("reuses the clean-start prerequisite without a redundant watcher build", async () => {
    root = await mkdtemp(join(tmpdir(), "omnidraw-inspection-prerequisite-test-"));
    const distRoot = join(root, "dist");
    const frontendRoot = resolve(import.meta.dir, "..");
    expect(await lstat(distRoot).catch(() => null)).toBeNull();

    const prerequisite = Bun.spawn({
      cmd: [process.execPath, "run", "scripts/build-inspection.ts", `--dist-root=${distRoot}`],
      cwd: frontendRoot,
      env: process.env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [exitCode, prerequisiteOutput, prerequisiteErrors] = await Promise.all([
      prerequisite.exited,
      new Response(prerequisite.stdout).text(),
      new Response(prerequisite.stderr).text(),
    ]);
    expect(exitCode, prerequisiteErrors).toBe(0);
    expect(prerequisiteOutput).toContain("[inspection-shell] ready");
    const identitiesBeforeWatch = await readdir(join(distRoot, ".inspection-builds"));

    child = Bun.spawn({
      cmd: [
        process.execPath,
        "run",
        "scripts/build-inspection.ts",
        "--watch",
        "--reuse-current",
        `--dist-root=${distRoot}`,
      ],
      cwd: frontendRoot,
      env: process.env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = child.stdout;
    const stderr = child.stderr;
    if (!(stdout instanceof ReadableStream) || !(stderr instanceof ReadableStream)) {
      throw new Error("Could not capture inspection watcher readiness.");
    }
    let output = "";
    let errors = "";
    void (async () => {
      for await (const bytes of stdout) output += new TextDecoder().decode(bytes);
    })();
    void (async () => {
      for await (const bytes of stderr) errors += new TextDecoder().decode(bytes);
    })();
    const deadline = Date.now() + 10_000;
    while (!output.includes("[inspection-shell] ready")) {
      if (Date.now() >= deadline) throw new Error(`Timed out waiting for reused prerequisite.\n${output}\n${errors}`);
      if (child.exitCode !== null) throw new Error(`Inspection watcher exited before readiness.\n${output}\n${errors}`);
      await Bun.sleep(25);
    }
    expect(output).toContain("watching verified prerequisite");
    expect(output).not.toContain("vite v");
    expect(await readdir(join(distRoot, ".inspection-builds"))).toEqual(identitiesBeforeWatch);
    child.kill("SIGTERM");
    expect(await child.exited).toBe(143);
    child = undefined;
  }, 60_000);

  test("starts retirement grace when an old current identity is replaced, not when it was built", async () => {
    root = await mkdtemp(join(tmpdir(), "omnidraw-inspection-retirement-test-"));
    const distRoot = join(root, "dist");
    const buildsRoot = join(distRoot, ".inspection-builds");
    await mkdir(buildsRoot, { recursive: true });
    const identities: string[] = [];

    const replacementAtMs = 2 * INSPECTION_BUILD_RETIREMENT_GRACE_MS;
    for (let index = 0; index < 7; index += 1) {
      const stagingPath = join(distRoot, `staging-${index}`);
      await mkdir(join(stagingPath, "assets"), { recursive: true });
      await writeFile(
        join(stagingPath, "index.html"),
        '<!doctype html><script type="module" src="./assets/loader.js"></script><script type="module" src="./assets/main.js"></script>',
      );
      await writeFile(
        join(stagingPath, "assets", "loader.js"),
        "const importFFI=1,importModuleLoader=2,loader={};export{loader as default}",
      );
      await writeFile(join(stagingPath, "assets", "main.js"), `globalThis.build=${index};`);
      const receipt = await publishInspectionStaging({
        stagingPath,
        distRoot,
        sourceFingerprint: `sha256:${index.toString(16).padStart(64, "0")}`,
        // Identity zero remains current beyond the entire grace interval. Its
        // safety clock must begin only when identity one replaces it.
        nowMs: index === 0 ? 0 : replacementAtMs + index - 1,
      });
      identities.push(receipt.buildId.slice("sha256:".length));
    }

    expect(new Set(identities).size).toBe(7);
    expect(await realpath(join(distRoot, "inspection"))).toBe(await realpath(join(buildsRoot, identities[6]!)));
    expect((await readdir(buildsRoot)).sort()).toEqual([...identities].sort());

    // Five rapid replacements put the old identity outside the four-build
    // recent set, but a lease-equivalent opened immediately before replacement
    // still pins it throughout the grace interval.
    expect((await lstat(join(buildsRoot, identities[0]!))).isDirectory()).toBe(true);
    expect(await verifyAndSealInspectionDist(join(buildsRoot, identities[0]!)))
      .toMatchObject({ buildId: `sha256:${identities[0]}` });
    const beforeGrace = await retireInspectionBuilds({
      buildsRoot,
      currentBuildPath: join(buildsRoot, identities[6]!),
      nowMs: replacementAtMs + INSPECTION_BUILD_RETIREMENT_GRACE_MS,
    });
    expect(beforeGrace).not.toContain(identities[0]);
    expect((await lstat(join(buildsRoot, identities[0]!))).isDirectory()).toBe(true);

    const afterGrace = await retireInspectionBuilds({
      buildsRoot,
      currentBuildPath: join(buildsRoot, identities[6]!),
      nowMs: replacementAtMs + INSPECTION_BUILD_RETIREMENT_GRACE_MS + 1,
    });
    expect(afterGrace).toContain(identities[0]);
    expect((await readdir(buildsRoot))).not.toContain(identities[0]);
    expect(await realpath(join(distRoot, "inspection"))).toBe(await realpath(join(buildsRoot, identities[6]!)));
  });

  test("rebuilds immediately when sources change between prerequisite and watcher startup", async () => {
    root = await mkdtemp(join(tmpdir(), "omnidraw-inspection-handoff-test-"));
    const distRoot = join(root, "dist");
    const watchRoot = join(root, "source-input");
    const frontendRoot = resolve(import.meta.dir, "..");
    await writeFile(watchRoot, "before prerequisite");
    const prerequisite = Bun.spawn({
      cmd: [
        process.execPath,
        "run",
        "scripts/build-inspection.ts",
        `--dist-root=${distRoot}`,
        `--watch-root=${watchRoot}`,
      ],
      cwd: frontendRoot,
      env: process.env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [exitCode, prerequisiteErrors] = await Promise.all([
      prerequisite.exited,
      new Response(prerequisite.stderr).text(),
    ]);
    expect(exitCode, prerequisiteErrors).toBe(0);
    const first = await verifyAndSealInspectionDist(join(distRoot, "inspection"));

    await writeFile(watchRoot, "changed before watcher startup");
    child = Bun.spawn({
      cmd: [
        process.execPath,
        "run",
        "scripts/build-inspection.ts",
        "--watch",
        "--reuse-current",
        `--dist-root=${distRoot}`,
        `--watch-root=${watchRoot}`,
      ],
      cwd: frontendRoot,
      env: process.env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = child.stdout;
    const stderr = child.stderr;
    if (!(stdout instanceof ReadableStream) || !(stderr instanceof ReadableStream)) {
      throw new Error("Could not capture inspection watcher handoff.");
    }
    let output = "";
    let errors = "";
    void (async () => {
      for await (const bytes of stdout) output += new TextDecoder().decode(bytes);
    })();
    void (async () => {
      for await (const bytes of stderr) errors += new TextDecoder().decode(bytes);
    })();
    const deadline = Date.now() + 30_000;
    while (!output.includes("[inspection-shell] ready")) {
      if (Date.now() >= deadline) throw new Error(`Timed out waiting for handoff rebuild.\n${output}\n${errors}`);
      if (child.exitCode !== null) throw new Error(`Inspection watcher exited during handoff.\n${output}\n${errors}`);
      await Bun.sleep(25);
    }
    const second = await verifyAndSealInspectionDist(join(distRoot, "inspection"));
    expect(second.buildId).not.toBe(first.buildId);
    expect(output).not.toContain("watching verified prerequisite");
    child.kill("SIGTERM");
    expect(await child.exited).toBe(143);
    child = undefined;
  }, 60_000);

  test("retries instead of publishing readiness when sources change during a build", async () => {
    root = await mkdtemp(join(tmpdir(), "omnidraw-inspection-stable-build-test-"));
    const distRoot = join(root, "dist");
    const watchRoot = join(root, "source-input");
    await writeFile(watchRoot, "initial source");
    child = Bun.spawn({
      cmd: [
        process.execPath,
        "run",
        "scripts/build-inspection.ts",
        `--dist-root=${distRoot}`,
        `--watch-root=${watchRoot}`,
      ],
      cwd: resolve(import.meta.dir, ".."),
      env: process.env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = child.stdout;
    const stderr = child.stderr;
    if (!(stdout instanceof ReadableStream) || !(stderr instanceof ReadableStream)) {
      throw new Error("Could not capture stable inspection build.");
    }
    let output = "";
    let errors = "";
    void (async () => {
      for await (const bytes of stdout) output += new TextDecoder().decode(bytes);
    })();
    void (async () => {
      for await (const bytes of stderr) errors += new TextDecoder().decode(bytes);
    })();
    const transformDeadline = Date.now() + 15_000;
    while (!output.includes("transforming")) {
      if (Date.now() >= transformDeadline) throw new Error(`Build did not begin transforming.\n${output}\n${errors}`);
      if (child.exitCode !== null) throw new Error(`Build exited before the causal edit.\n${output}\n${errors}`);
      await Bun.sleep(10);
    }
    await writeFile(watchRoot, "source changed during build");
    expect(await child.exited).toBe(0);
    child = undefined;
    expect(`${output}\n${errors}`).toContain("sources changed during build; retrying stable build");
    expect((output.match(/\[inspection-shell\] ready/g) ?? [])).toHaveLength(1);
    expect(await readdir(join(distRoot, ".inspection-builds"))).toHaveLength(1);
    await verifyAndSealInspectionDist(join(distRoot, "inspection"));
  }, 60_000);

  test("discovers and marks an untracked orphan before retiring it after a full grace period", async () => {
    root = await mkdtemp(join(tmpdir(), "omnidraw-inspection-orphan-test-"));
    const distRoot = join(root, "dist");
    const buildsRoot = join(distRoot, ".inspection-builds");
    const retirementsRoot = join(distRoot, ".inspection-retirements");
    const currentIdentity = "a".repeat(64);
    const orphanIdentity = "b".repeat(64);
    await mkdir(join(buildsRoot, currentIdentity), { recursive: true });
    await mkdir(join(buildsRoot, orphanIdentity), { recursive: true });
    await mkdir(retirementsRoot, { recursive: true });

    const discoveredAtMs = 10_000;
    expect(await retireInspectionBuilds({
      buildsRoot,
      currentBuildPath: join(buildsRoot, currentIdentity),
      retirementsRoot,
      nowMs: discoveredAtMs,
      retainRecent: 1,
    })).toEqual([]);
    expect(JSON.parse(await Bun.file(join(retirementsRoot, `${orphanIdentity}.json`)).text()))
      .toEqual({ unpublishedAtMs: discoveredAtMs });
    expect(await lstat(join(retirementsRoot, `${currentIdentity}.json`)).catch(() => null)).toBeNull();

    expect(await retireInspectionBuilds({
      buildsRoot,
      currentBuildPath: join(buildsRoot, currentIdentity),
      retirementsRoot,
      nowMs: discoveredAtMs + INSPECTION_BUILD_RETIREMENT_GRACE_MS + 1,
      retainRecent: 1,
    })).toEqual([orphanIdentity]);
    expect(await lstat(join(buildsRoot, orphanIdentity)).catch(() => null)).toBeNull();
    expect((await lstat(join(buildsRoot, currentIdentity))).isDirectory()).toBe(true);
  });
});
