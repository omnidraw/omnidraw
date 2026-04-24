import { Button } from "@kobalte/core/button";
import * as ToggleButton from "@kobalte/core/toggle-button";
import { useLocation, useNavigate } from "@solidjs/router";
import MoonStar from "lucide-solid/icons/moon-star";
import PanelLeft from "lucide-solid/icons/panel-left";
import Plus from "lucide-solid/icons/plus";
import Sun from "lucide-solid/icons/sun";
import type { Component } from "solid-js";
import { For, createSignal } from "solid-js";
import { showErrorToast } from "@/components/ui/Toast";
import { removeFromCache } from "@/services/automerge";
import { orpcWebsocketService } from "@/services/orpc-websocket";
import { themeService, txSetThemeAppearance } from "@/services/theme";
import { setStore, store } from "@/store";
import type { TBackendCanvas } from "../../../types/backend.types";
import { CreateCanvasDialog } from "./CreateCanvasDialog";
import { DeleteCanvasDialog } from "./DeleteCanvasDialog";
import { RenameDialog } from "./RenameDialog";
import SidebarItem from "./SidebarItem";
import styles from "./Sidebar.module.css";

export type SidebarProps = {
  visible?: boolean;
  onToggleSidebar?: () => void;
};

const Sidebar: Component<SidebarProps> = (props) => {
  const navigate = useNavigate();
  const location = useLocation();

  const activeCanvasId = () => {
    const match = location.pathname.match(/^\/c\/(.+)/);
    return match ? match[1] : null;
  };

  const [renameDialogOpen, setRenameDialogOpen] = createSignal(false);
  const [canvasToRename, setCanvasToRename] = createSignal<{
    id: string;
    name: string;
  } | null>(null);

  const [deleteDialogOpen, setDeleteDialogOpen] = createSignal(false);
  const [canvasToDelete, setCanvasToDelete] = createSignal<TBackendCanvas | null>(null);

  const [createDialogOpen, setCreateDialogOpen] = createSignal(false);

  const handleOpenRenameDialog = (canvasId: string, canvasName: string) => {
    setCanvasToRename({ id: canvasId, name: canvasName });
    setRenameDialogOpen(true);
  };

  const handleOpenDeleteDialog = (canvas: TBackendCanvas) => {
    setCanvasToDelete(canvas);
    setDeleteDialogOpen(true);
  };

  const handleRename = async (newName: string) => {
    const canvas = canvasToRename();
    if (canvas) {
      const [err, data] = await orpcWebsocketService.apiService.api.canvas.update({ params: { id: canvas.id }, body: { name: newName } });
      if (err) showErrorToast(err.message);
      if (data) {
        setStore("canvases", (c) => c.id === canvas.id, data);
      }
    }
  };

  const handleDelete = async () => {
    const canvas = canvasToDelete();
    if (canvas) {
      const isActive = activeCanvasId() === canvas.id;
      const [err, data] = await orpcWebsocketService.apiService.api.canvas.remove({ params: { id: canvas.id } });
      if (err) showErrorToast(err.message);
      if (data) {
        removeFromCache(data.automerge_url);
        setStore("canvases", (prev) => prev.filter((c) => c.id !== data.id));
        if (isActive) navigate("/");
      }
    }
  };

  const handleCreateCanvas = async (title: string) => {
    const [err, data] = await orpcWebsocketService.apiService.api.canvas.create({ name: title });
    if (err) showErrorToast(err.message);
    if (data) {
      setStore("canvases", (prev) => [...prev, data]);
      navigate(`/c/${data.id}`);
    }
  };

  const isDarkTheme = () => {
    void store.theme;
    return themeService.getTheme().appearance === "dark";
  };

  const handleThemeToggle = (pressed: boolean) => {
    txSetThemeAppearance(pressed ? "dark" : "light");
  };

  const sidebarClass = () => {
    return [styles.sidebar, props.visible === false ? styles.sidebarHidden : ""].filter(Boolean).join(" ");
  };

  return (
    <>
      <aside class={sidebarClass()} aria-label="Canvas navigation">
        <div class={styles.header}>
          <div class={styles.brandLockup}>
            <h1 class={styles.brand}>VIBECANVAS</h1>
          </div>
          <Button
            class={styles.sidebarToggle}
            onClick={() => props.onToggleSidebar?.()}
            aria-label="Toggle sidebar"
          >
            <PanelLeft size={15} />
          </Button>
        </div>

        <div class={styles.primaryAction}>
          <Button
            class={styles.createButton}
            onClick={() => setCreateDialogOpen(true)}
          >
            <Plus size={15} class={styles.createIcon} />
            <span class={styles.createLabel}>New Canvas</span>
          </Button>
        </div>

        <nav class={styles.nav} aria-label="Canvases">
          <div class={styles.sectionHeader}>
            <span class={styles.sectionTitle}>Canvases</span>
            <span class={styles.sectionCount}>{store.canvases.length}</span>
          </div>

          <div class={styles.list}>
            <For
              each={store.canvases}
              fallback={
                <div class={styles.emptyState}>
                  <p class={styles.emptyTitle}>No canvases yet</p>
                  <p class={styles.emptyBody}>Create one to start drawing.</p>
                </div>
              }
            >
              {(canvas) => (
                <SidebarItem
                  name={canvas.name}
                  selected={activeCanvasId() === canvas.id}
                  onClick={() => navigate(`/c/${canvas.id}`)}
                  onRename={() => handleOpenRenameDialog(canvas.id, canvas.name)}
                  onDelete={() => handleOpenDeleteDialog(canvas)}
                />
              )}
            </For>
          </div>
        </nav>

        <div class={styles.footer}>
          <ToggleButton.Root
            pressed={isDarkTheme()}
            onChange={handleThemeToggle}
            class={styles.themeToggle}
            aria-label="Toggle dark theme"
          >
            <div class={styles.themeToggleLead}>
              {isDarkTheme() ? <MoonStar size={14} class={styles.themeIconDark} /> : <Sun size={14} class={styles.themeIconLight} />}
              <span class={styles.themeToggleLabel}>Theme</span>
            </div>
            <span class={styles.themeStatus}>
              {isDarkTheme() ? "Dark" : "Light"}
            </span>
          </ToggleButton.Root>
        </div>
      </aside>

      <RenameDialog
        open={renameDialogOpen()}
        onOpenChange={setRenameDialogOpen}
        currentName={canvasToRename()?.name ?? ""}
        onRename={handleRename}
      />

      <DeleteCanvasDialog
        open={deleteDialogOpen()}
        onOpenChange={setDeleteDialogOpen}
        canvas={canvasToDelete()}
        onDelete={handleDelete}
      />

      <CreateCanvasDialog
        open={createDialogOpen()}
        onOpenChange={setCreateDialogOpen}
        onCanvasCreated={handleCreateCanvas}
      />
    </>
  );
};

export default Sidebar;
