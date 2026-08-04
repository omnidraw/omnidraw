import { DEFAULT_THEME_ID, THEME_ID_DARK, type ThemeId } from "@omnidraw/service-theme";
import { createStore, type SetStoreFunction } from "solid-js/store";
import type { TBackendCanvas } from "./types/backend.types";

type TGlobalStore = {
  theme: ThemeId;
  lastLightThemeId: ThemeId;
  lastDarkThemeId: ThemeId;
  sidebarVisible: boolean;
  canvases: TBackendCanvas[];
};

const DEFAULT_STORE: TGlobalStore = {
  theme: DEFAULT_THEME_ID,
  lastLightThemeId: DEFAULT_THEME_ID,
  lastDarkThemeId: THEME_ID_DARK,
  sidebarVisible: true,
  canvases: [],
};

function readPersistedStore(key: string): TGlobalStore {
  try {
    const value = localStorage.getItem(key);
    if (!value) return structuredClone(DEFAULT_STORE);
    const parsed = JSON.parse(value) as Partial<TGlobalStore> | null;
    if (!parsed || typeof parsed !== "object") return structuredClone(DEFAULT_STORE);
    return { ...structuredClone(DEFAULT_STORE), ...parsed };
  } catch {
    return structuredClone(DEFAULT_STORE);
  }
}

const activeStorageKey = 'omnidraw:frontend';
const [store, setStoreBase] = createStore<TGlobalStore>(readPersistedStore(activeStorageKey));

function persistStore(): void {
  try {
    localStorage.setItem(activeStorageKey, JSON.stringify(store));
  } catch {
    // Browser persistence is best-effort; the reactive store remains usable.
  }
}

const setStore = ((...args: unknown[]) => {
  (setStoreBase as (...values: unknown[]) => void)(...args);
  persistStore();
}) as SetStoreFunction<TGlobalStore>;

async function init(): Promise<void> {
  return undefined;
}

export { init, setStore, store };
export type { TGlobalStore };
