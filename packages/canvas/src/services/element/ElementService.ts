import type { IService } from "@vibecanvas/runtime";
import { SyncHook } from "@vibecanvas/tapable";

export interface TCanvasRegistryServiceHooks {
  elementsChange: SyncHook<[]>;
}

export class ElementService implements IService<TCanvasRegistryServiceHooks> {
  readonly name = "ElementService";
  readonly hooks: TCanvasRegistryServiceHooks = {
    elementsChange: new SyncHook<[]>,
  };

}
