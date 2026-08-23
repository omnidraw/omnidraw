#!/usr/bin/env bun

import { chromium } from "playwright";
import { resolve } from "node:path";
import { PreviewInspectionShellServer } from "../apps/backend/src/shell/preview/PreviewInspectionShellServer";
import { resolvePreviewInspectionReleaseRuntime } from "../apps/backend/src/shell/preview/preview-inspection-release-runtime";

const root = resolve(import.meta.dir, "..");
const runtime = resolvePreviewInspectionReleaseRuntime({
  sourceCliDir: resolve(root, "apps/backend/src/shell/runtime"),
});
const server = new PreviewInspectionShellServer({
  distPath: runtime.shellPath,
  createToken: () => "built-shell-smoke-token",
});
const lease = await server.open("built-shell-smoke");
const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage();
  const response = await page.goto(lease.url, { waitUntil: "networkidle" });
  if (response?.ok() !== true) throw new Error(`Preview inspection entry returned ${response?.status() ?? "no response"}.`);
  await page.waitForFunction(() => (
    window.__OMNIDRAW_PREVIEW_INSPECTION_SHELL__?.format
      === "omnidraw.preview-inspection-shell.v1"
  ));
  const failed = (await page.context().request.get(new URL("/assets/missing.js", lease.url).href)).status();
  if (failed !== 404) throw new Error(`Unleased inspection asset request returned ${failed}.`);
  await page.close();
  console.log("[inspection-shell] built tokenized shell loaded in Chromium");
} finally {
  lease.release();
  await browser.close();
  await server.stop();
}
