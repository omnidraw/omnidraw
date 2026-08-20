import {
  THEME_ID_DARK,
  THEME_ID_LIGHT,
  THEME_ID_SEPIA,
} from "@omnidraw/theme";
import { describe, expect, test } from "vitest";
import { createFrontendThemeController } from "../../src/shell/browser/theme";
import {
  createFrontendStore,
  type TFrontendStoragePort,
} from "../../src/shell/framework/state/store";

class RecordingStorage implements TFrontendStoragePort {
  readonly writes: string[] = [];

  constructor(private readonly initial: string | null = null) {}

  getItem(): string | null {
    return this.initial;
  }

  setItem(_key: string, value: string): void {
    this.writes.push(value);
  }
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("createFrontendStore", () => {
  test("persists one settled write exactly once", async () => {
    const storage = new RecordingStorage();
    const store = createFrontendStore(storage);

    store.set("sidebarVisible", false);
    expect(storage.writes).toEqual([]);
    await settle();

    expect(storage.writes).toHaveLength(1);
    expect(JSON.parse(storage.writes[0]!)).toMatchObject({ sidebarVisible: false });
    await settle();
    expect(storage.writes).toHaveLength(1);
    store.dispose();
  });

  test("persists the newest settled state once for a burst and excludes Canvas identities", async () => {
    const storage = new RecordingStorage();
    const store = createFrontendStore(storage);

    store.set("canvases", [{ id: "backend-canvas" } as never]);
    store.set("sidebarVisible", false);
    store.set("theme", THEME_ID_DARK);
    store.set("theme", THEME_ID_SEPIA);

    expect(storage.writes).toEqual([]);
    await settle();

    expect(storage.writes).toHaveLength(1);
    expect(JSON.parse(storage.writes[0]!)).toEqual({
      theme: THEME_ID_SEPIA,
      lastLightThemeId: THEME_ID_LIGHT,
      lastDarkThemeId: THEME_ID_DARK,
      sidebarVisible: false,
    });
    expect(storage.writes[0]).not.toContain("backend-canvas");
    store.dispose();
  });

  test("never restores backend-authoritative Canvas identities", () => {
    const storage = new RecordingStorage(JSON.stringify({
      theme: THEME_ID_DARK,
      sidebarVisible: false,
      canvases: [{ id: "stale-browser-canvas" }],
    }));
    const store = createFrontendStore(storage);

    expect(store.state.canvases).toEqual([]);
    store.dispose();
  });
});

describe("createFrontendThemeController", () => {
  test("carries rapid appearance memory forward without stale post-set reads", async () => {
    const storage = new RecordingStorage();
    const store = createFrontendStore(storage);
    const controller = createFrontendThemeController({ store, document });

    controller.setTheme(THEME_ID_SEPIA);
    controller.setAppearance("dark");
    controller.setAppearance("light");
    await settle();

    expect(controller.service.getThemeId()).toBe(THEME_ID_SEPIA);
    expect(store.state.theme).toBe(THEME_ID_SEPIA);
    expect(store.state.lastLightThemeId).toBe(THEME_ID_SEPIA);
    expect(store.state.lastDarkThemeId).toBe(THEME_ID_DARK);

    controller.dispose();
    store.dispose();
  });
});
