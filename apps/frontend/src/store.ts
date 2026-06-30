import { makePersisted } from "@solid-primitives/storage";
import { DEFAULT_THEME_ID, THEME_ID_DARK, type ThemeId } from "@vibecanvas/service-theme";
import { createStore } from "solid-js/store";
import type { TBackendCanvas } from "./types/backend.types";
import { orpcWebsocketService } from "./services/orpc-websocket";

type TGlobalStore = {
  theme: ThemeId;
  lastLightThemeId: ThemeId;
  lastDarkThemeId: ThemeId;
  sidebarVisible: boolean;
  canvases: TBackendCanvas[];
};

const [store, setStore, init] = makePersisted(createStore<TGlobalStore>({
  theme: DEFAULT_THEME_ID,
  lastLightThemeId: DEFAULT_THEME_ID,
  lastDarkThemeId: THEME_ID_DARK,
  sidebarVisible: true,
  canvases: [],
}), { name: "vibecanvas" });

// Fetch canvas list on startup
orpcWebsocketService.apiService.api.canvas.list()
  .then(([err, result]) => {
    if (err) return;
    setStore("canvases", result);
  });

export { init, setStore, store };
