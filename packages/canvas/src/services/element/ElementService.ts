import type { IService } from "@vibecanvas/runtime";
import { SyncHook } from "@vibecanvas/tapable";

export interface TElementServiceHooks {
  elementsChange: SyncHook<[]>;
}

export class ElementService implements IService<TElementServiceHooks> {
  readonly name = "ElementService";
  readonly hooks: TElementServiceHooks = {
    elementsChange: new SyncHook<[]>,
  };

}
