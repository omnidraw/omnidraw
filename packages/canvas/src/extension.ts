import type { IPlugin, IService } from "@vibecanvas/runtime";
import type { IRuntimeConfig, IRuntimeHooks, IRuntimeServices } from "./types";

export type TCanvasRuntimePlugin = IPlugin<any, IRuntimeHooks, IRuntimeConfig>;

export type TCanvasExtensionServiceRegistration = {
  name: string;
  startOrder: number;
  service: IService;
};

export type TCanvasRuntimeExtensionInstall = {
  services?: readonly TCanvasExtensionServiceRegistration[];
  plugins?: readonly TCanvasRuntimePlugin[];
  dispose?: () => void | Promise<void>;
};

export type TCanvasRuntimeExtensionContext = {
  config: IRuntimeConfig;
  hooks: IRuntimeHooks;
  services: IRuntimeServices;
};

/**
 * Installs optional element/runtime capabilities without making canvas depend on
 * their concrete package. Extensions are installed in array order before scene
 * hydration and are disposed in reverse order during runtime shutdown.
 */
export interface ICanvasRuntimeExtension {
  readonly name: string;
  install(context: TCanvasRuntimeExtensionContext): TCanvasRuntimeExtensionInstall;
}
