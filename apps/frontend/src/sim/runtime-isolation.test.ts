import { expect, test } from "bun:test";
import { fxFrontendRequest } from "@/core/app/service.frontend-transport";
import { txStartupCanvas } from "@/core/app/startup-canvas";
import { txRouteNotificationToast } from "@/core/notifications/tx.route-notification-toast";
import { createFrontendSimRuntime } from "./runtime";

test("simulated app runtimes isolate controlled world state and fence disposal", async () => {
  const first = createFrontendSimRuntime({
    browser: { idPrefix: "first", firstId: 10, firstTimeMillis: 100 },
    storage: [["theme", "dark"]],
  });
  const second = createFrontendSimRuntime({
    browser: { idPrefix: "second", firstId: 20, firstTimeMillis: 200 },
    storage: [["theme", "light"]],
  });
  first.transport.enqueueRequest("canvas.list", { value: [{ id: "first-result", name: "First", revision: 1 }] });
  second.transport.enqueueRequest("canvas.list", { value: [{ id: "second-result", name: "Second", revision: 1 }] });

  expect(await first.runPromise(fxFrontendRequest({ path: "canvas.list", input: {} }))).toEqual([{ id: "first-result", name: "First", revision: 1 }]);
  expect(await second.runPromise(fxFrontendRequest({ path: "canvas.list", input: {} }))).toEqual([{ id: "second-result", name: "Second", revision: 1 }]);
  expect(first.browser.nextId()).toBe("first-10");
  expect(second.browser.nextId()).toBe("second-20");
  expect(first.storage.getItem("theme")).toBe("dark");
  expect(second.storage.getItem("theme")).toBe("light");

  await first.runPromise(txStartupCanvas({ pathname: "/", requestId: 1 }));
  await second.runPromise(txStartupCanvas({ pathname: "/", requestId: 1 }));
  expect(first.navigation.entries()[0]?.path).toContain("first-");
  expect(second.navigation.entries()[0]?.path).toContain("second-");
  await first.runPromise(txRouteNotificationToast({ event: { type: "info", title: "first" } }));
  expect(first.notifications.entries().map((entry) => entry.title)).toEqual(["first"]);
  expect(second.notifications.entries()).toEqual([]);

  await first.dispose();
  await expect(first.runPromise(fxFrontendRequest({ path: "canvas.list", input: {} }))).rejects.toThrow("disposed");
  expect(await second.runPromise(txRouteNotificationToast({ event: { type: "success", title: "still-live" } }))).toBeUndefined();
  await second.dispose();
});
