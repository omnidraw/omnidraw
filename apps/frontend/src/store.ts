import { DEFAULT_THEME_ID, THEME_ID_DARK, type ThemeId } from "@omnidraw/service-theme";
import { createStore, reconcile, type SetStoreFunction } from "solid-js/store";
import { fnBrowserTenantStorageKeys, type TBrowserTenantScope } from "./services/fn.browser-tenant-scope";
import { getBrowserTenantScope } from "./services/tenant";
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

function storageKey(scope: TBrowserTenantScope): string {
  return fnBrowserTenantStorageKeys(scope).frontendStore;
}

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

let activeStorageKey = storageKey(getBrowserTenantScope());
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

function switchFrontendStoreTenant(scope: TBrowserTenantScope): void {
  activeStorageKey = storageKey(scope);
  setStoreBase(reconcile(readPersistedStore(activeStorageKey)));
}

async function init(): Promise<void> {
  return undefined;
}

export { init, setStore, store, switchFrontendStoreTenant };
export type { TGlobalStore };
