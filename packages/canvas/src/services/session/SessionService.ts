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

  private editingId: string | null = null;

  getEditingId(): string | null {
    return this.editingId;
  }

  setEditingId(editingId: string | null) {
    this.editingId = editingId;
    this.hooks.editingChange.call(editingId);
  }
}
