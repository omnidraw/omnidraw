import { DEFAULT_THEME_ID, THEME_ID_DARK, type ThemeId } from "@omnidraw/theme";
import { createEffect, createRoot, createStore, storePath } from "solid-js";
import type { TBackendCanvas } from "@/core/app/backend.types";

export type TFrontendStoreState = {
  theme: ThemeId;
  lastLightThemeId: ThemeId;
  lastDarkThemeId: ThemeId;
  sidebarVisible: boolean;
  canvases: TBackendCanvas[];
};

export type TFrontendStore = Readonly<{
  state: TFrontendStoreState;
  set<Key extends keyof TFrontendStoreState>(
    key: Key,
    value: TFrontendStoreState[Key] | ((current: TFrontendStoreState[Key]) => TFrontendStoreState[Key]),
  ): void;
  dispose(): void;
}>;

export type TFrontendStoragePort = Readonly<{
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}>;

const STORAGE_KEY = "omnidraw:frontend";
const DEFAULT_STORE: TFrontendStoreState = {
  theme: DEFAULT_THEME_ID,
  lastLightThemeId: DEFAULT_THEME_ID,
  lastDarkThemeId: THEME_ID_DARK,
  sidebarVisible: true,
  canvases: [],
};

function themeId(value: unknown, fallback: ThemeId): ThemeId {
  return typeof value === "string" && value.length > 0 ? value as ThemeId : fallback;
}

function readPersistedStore(storage: TFrontendStoragePort): TFrontendStoreState {
  try {
    const value = storage.getItem(STORAGE_KEY);
    if (value === null) return { ...DEFAULT_STORE, canvases: [] };
    const parsed = JSON.parse(value) as Record<string, unknown> | null;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ...DEFAULT_STORE, canvases: [] };
    }
    return {
      theme: themeId(parsed.theme, DEFAULT_STORE.theme),
      lastLightThemeId: themeId(parsed.lastLightThemeId, DEFAULT_STORE.lastLightThemeId),
      lastDarkThemeId: themeId(parsed.lastDarkThemeId, DEFAULT_STORE.lastDarkThemeId),
      sidebarVisible: typeof parsed.sidebarVisible === "boolean"
        ? parsed.sidebarVisible
        : DEFAULT_STORE.sidebarVisible,
      // Canvas identities are backend-authoritative and are never restored from
      // browser persistence.
      canvases: [],
    };
  } catch {
    return { ...DEFAULT_STORE, canvases: [] };
  }
}

export function createFrontendStore(storage: TFrontendStoragePort): TFrontendStore {
  return createRoot((dispose) => {
    const [state, setBase] = createStore<TFrontendStoreState>(readPersistedStore(storage));

    createEffect(
      () => ({
        theme: state.theme,
        lastLightThemeId: state.lastLightThemeId,
        lastDarkThemeId: state.lastDarkThemeId,
        sidebarVisible: state.sidebarVisible,
      }),
      (persisted) => {
        try {
          storage.setItem(STORAGE_KEY, JSON.stringify(persisted));
        } catch {
          // Browser persistence is best-effort; the isolated reactive store stays usable.
        }
      },
      { defer: true },
    );

    return Object.freeze({
      state,
      set<Key extends keyof TFrontendStoreState>(
        key: Key,
        value: TFrontendStoreState[Key] | ((current: TFrontendStoreState[Key]) => TFrontendStoreState[Key]),
      ): void {
        setBase(storePath(key, (current: TFrontendStoreState[Key]) => (
          typeof value === "function"
            ? (value as (previous: TFrontendStoreState[Key]) => TFrontendStoreState[Key])(current)
            : value
        )));
      },
      dispose,
    });
  });
}
