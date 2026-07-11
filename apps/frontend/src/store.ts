import { makePersisted } from "@solid-primitives/storage";
import { DEFAULT_THEME_ID, THEME_ID_DARK, type ThemeId } from "@vibecanvas/service-theme";
import { createStore, type SetStoreFunction, type Store } from "solid-js/store";
import type { TBackendCanvas } from "./types/backend.types";

type TGlobalStore = {
  theme: ThemeId;
  lastLightThemeId: ThemeId;
  lastDarkThemeId: ThemeId;
  sidebarVisible: boolean;
  canvases: TBackendCanvas[];
};

const [store, setStore, init] = makePersisted<TGlobalStore, [Store<TGlobalStore>, SetStoreFunction<TGlobalStore>]>(createStore<TGlobalStore>({
  theme: DEFAULT_THEME_ID,
  lastLightThemeId: DEFAULT_THEME_ID,
  lastDarkThemeId: THEME_ID_DARK,
  sidebarVisible: true,
  canvases: [],
}), { name: "vibecanvas" });

export { init, setStore, store };
