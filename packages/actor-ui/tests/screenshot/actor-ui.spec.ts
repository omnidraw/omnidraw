import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const screenshotDir = resolve(import.meta.dirname, "../screenshots");

test("renders demo actors for visual inspection", async ({ page }) => {
  await mkdir(screenshotDir, { recursive: true });
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "State machine inspector" })).toBeVisible();
  await expect(page.locator(".vc-actor-ui__node")).toHaveCount(6);
  await expect(page.locator(".vc-actor-ui__edge")).toHaveCount(6);
  await expect(page.locator(".vc-actor-ui__edge--implicit")).toHaveCount(1);
  await page.screenshot({
    path: resolve(screenshotDir, "repo-health.png"),
    fullPage: true,
  });

  const actorSelect = page.getByRole("combobox", { name: "Actor" });

  await actorSelect.selectOption("draft-writer");
  await expect(page.locator(".vc-actor-ui__node")).toHaveCount(5);
  await expect(page.getByRole("heading", { name: "waiting.review" })).toBeVisible();
  await page.screenshot({
    path: resolve(screenshotDir, "draft-writer.png"),
    fullPage: true,
  });

  await actorSelect.selectOption("empty-machine");
  await expect(page.locator(".vc-actor-ui__node")).toHaveCount(3);
  await expect(page.locator(".vc-actor-ui__edge--implicit")).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "booting" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "ready" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "error" })).toBeVisible();
  await page.screenshot({
    path: resolve(screenshotDir, "empty-machine.png"),
    fullPage: true,
  });
});
