import { Button } from "@kobalte/core/button";
import { Dialog } from "@kobalte/core/dialog";
import ArrowUp from "lucide-solid/icons/arrow-up";
import ChevronRight from "lucide-solid/icons/chevron-right";
import Folder from "lucide-solid/icons/folder";
import House from "lucide-solid/icons/house";
import { For, Show, createEffect, createSignal } from "solid-js";
import { ScrollArea } from "@/components/ui/scroll-area";
import { orpcWebsocketService } from "@/services/orpc-websocket";
import styles from "./path-picker-dialog.module.css";

type TDirChild = {
  name: string;
  path: string;
};

type TPathPickerDialogProps = {
  open: boolean;
  initialPath: string | null;
  onOpenChange: (open: boolean) => void;
  onPathSelected: (path: string) => void | Promise<void>;
  title: string;
  description?: string;
};

export function PathPickerDialog(props: TPathPickerDialogProps) {
  const [currentPath, setCurrentPath] = createSignal("");
  const [parentPath, setParentPath] = createSignal<string | null>(null);
  const [children, setChildren] = createSignal<TDirChild[]>([]);
  const [pathInput, setPathInput] = createSignal("");
  const [isLoading, setIsLoading] = createSignal(false);
  const [errorMessage, setErrorMessage] = createSignal<string | null>(null);

  const secondaryButtonClass = `${styles.button} ${styles.secondaryButton}`;
  const primaryButtonClass = `${styles.button} ${styles.primaryButton}`;

  const loadDirectory = async (path: string) => {
    setIsLoading(true);
    setErrorMessage(null);

    const [listError, listResult] = await orpcWebsocketService.apiService.api.filesystem.list({
      query: { path, omitFiles: true },
    });

    setIsLoading(false);

    if (listError || !listResult || "type" in listResult) {
      setErrorMessage(listError?.message ?? (listResult && "message" in listResult ? listResult.message : "Failed to load folders"));
      return false;
    }

    setCurrentPath(listResult.current);
    setPathInput(listResult.current);
    setParentPath(listResult.parent);
    setChildren(listResult.children);
    return true;
  };

  const loadHomeDirectory = async () => {
    setIsLoading(true);
    setErrorMessage(null);

    const [homeError, homeResult] = await orpcWebsocketService.apiService.api.filesystem.home();

    if (homeError || !homeResult || "type" in homeResult) {
      setIsLoading(false);
      setErrorMessage(homeError?.message ?? (homeResult && "message" in homeResult ? homeResult.message : "Failed to load home folder"));
      return;
    }

    setIsLoading(false);
    await loadDirectory(homeResult.path);
  };

  createEffect(() => {
    if (!props.open) return;

    const initialPath = props.initialPath?.trim();
    if (initialPath) {
      void loadDirectory(initialPath).then((ok) => {
        if (!ok) void loadHomeDirectory();
      });
      return;
    }

    void loadHomeDirectory();
  });

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay class={styles.overlay} />
        <Dialog.Content
          class={styles.content}
          onWheel={(e: WheelEvent) => {
            e.stopPropagation();
            if (e.ctrlKey) e.preventDefault();
          }}
          style={{ "overscroll-behavior": "contain" }}
        >
          <Dialog.Title class={styles.title}>{props.title}</Dialog.Title>
          <Show when={props.description}>
            <Dialog.Description class={styles.description}>
              {props.description}
            </Dialog.Description>
          </Show>

          <div class={styles.toolbar}>
            <Button
              class={secondaryButtonClass}
              disabled={isLoading()}
              onClick={() => void loadHomeDirectory()}
              title="Go to home"
            >
              <div class={styles.buttonContent}>
                <House size={12} />
                Home
              </div>
            </Button>
            <Button
              class={secondaryButtonClass}
              disabled={isLoading() || !parentPath()}
              onClick={() => {
                const parent = parentPath();
                if (parent) void loadDirectory(parent);
              }}
              title="Go up"
            >
              <div class={styles.buttonContent}>
                <ArrowUp size={12} />
                Up
              </div>
            </Button>
          </div>

          <div class={styles.pathRow}>
            <input
              class={styles.pathInput}
              value={pathInput()}
              onInput={(event) => setPathInput(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                const nextPath = pathInput().trim();
                if (!nextPath) return;
                void loadDirectory(nextPath);
              }}
              placeholder="Paste full path"
            />
            <Button
              class={secondaryButtonClass}
              disabled={isLoading() || !pathInput().trim()}
              onClick={() => {
                const nextPath = pathInput().trim();
                if (!nextPath) return;
                void loadDirectory(nextPath);
              }}
            >
              Go
            </Button>
          </div>

          <ScrollArea class={styles.listArea} viewportClass={styles.listViewport}>
            <div class={styles.listContent}>
              <Show when={!isLoading()} fallback={<div class={styles.stateText}>Loading folders...</div>}>
                <Show when={!errorMessage()} fallback={<div class={styles.errorText}>{errorMessage()}</div>}>
                  <Show when={children().length > 0} fallback={<div class={styles.stateText}>No subfolders</div>}>
                    <For each={children()}>
                      {(child) => (
                        <button
                          type="button"
                          class={styles.folderButton}
                          onClick={() => void loadDirectory(child.path)}
                        >
                          <div class={styles.folderInfo}>
                            <Folder size={12} class={styles.folderIcon} />
                            <span class={styles.folderName}>{child.name}</span>
                          </div>
                          <ChevronRight size={12} class={styles.folderArrow} />
                        </button>
                      )}
                    </For>
                  </Show>
                </Show>
              </Show>
            </div>
          </ScrollArea>

          <div class={styles.actions}>
            <Button
              class={secondaryButtonClass}
              onClick={() => props.onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              class={primaryButtonClass}
              disabled={isLoading() || !currentPath()}
              onClick={() => void props.onPathSelected(currentPath())}
            >
              Use This Folder
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  );
}
