import { IService } from "@vibecanvas/runtime";
import { SyncHook } from "@vibecanvas/tapable";

type TEditorServiceHooks = {
  editingChange: SyncHook<string | null>;
};
/**
 * Session Service is for temporary data. like edit state
 * which needs to be shared by multiple services/plugins
 */
export class SessionService implements IService {
  name: string = "SessionService";
  hooks: TEditorServiceHooks = {
    editingChange: new SyncHook<string | null>(),
  };

  #_editingId: string | null = null;

  get editingId() {
    return this.#_editingId;
  }

  set editingId(editingId: string | null) {
    this.#_editingId = editingId;
    this.hooks.editingChange.call(editingId);
  }
}
