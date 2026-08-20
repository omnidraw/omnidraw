import { ChevronRight, MoonStar, PanelLeft, Plus, Sun } from "@/shell/framework/components/icons";
import type { Component } from "solid-js";
import { For, Show, createSignal, onSettled, untrack } from "solid-js";
import type { TCanvasDeletionResult } from "@/core/app/private-operation-contract";
import { fnCanvasDeletionRoute } from "@/core/navigation/fn.canvas-deletion-route";
import { WidgetsSidebarSection } from "../widgets/components/WidgetsSidebarSection";
import type { TSidebarCanvas, TSidebarController } from "../ports";
import { CreateCanvasDialog } from "./CreateCanvasDialog";
import { CreateResourceDialog } from "./CreateResourceDialog";
import { DeleteCanvasDialog } from "./DeleteCanvasDialog";
import { OmnidrawLogo } from "./OmnidrawLogo";
import { RenameDialog } from "./RenameDialog";
import SidebarItem from "./SidebarItem";
import styles from "./Sidebar.module.css";

export type SidebarProps = {
  controller: TSidebarController;
  visible?: boolean;
  onToggleSidebar?: () => void;
};

const Sidebar: Component<SidebarProps> = (props) => {
  // The controller is a mount-stable injected capability. Snapshot it once so
  // event handlers and async continuations never read the reactive component
  // prop outside a tracking scope.
  const controller = untrack(() => props.controller);
  const application = controller.application;

  const activeCanvasId = () => {
    const match = application.pathname().match(/^\/c\/(.+)/);
    return match ? match[1] : null;
  };

  const activeResourceId = () => application.pathname().match(/^\/resources\/([^/]+)/)?.[1] ?? null;

  const [renameDialogOpen, setRenameDialogOpen] = createSignal(false);
  const [canvasToRename, setCanvasToRename] = createSignal<{
    id: string;
    name: string;
  } | null>(null);
  const [renameDialogTrigger, setRenameDialogTrigger] = createSignal<HTMLButtonElement | null>(null);

  const [deleteDialogOpen, setDeleteDialogOpen] = createSignal(false);
  const [canvasToDelete, setCanvasToDelete] = createSignal<TSidebarCanvas | null>(null);
  const [deleteDialogTrigger, setDeleteDialogTrigger] = createSignal<HTMLButtonElement | null>(null);

  const [createDialogOpen, setCreateDialogOpen] = createSignal(false);
  const [canvasesExpanded, setCanvasesExpanded] = createSignal(true);
  const [resourcesExpanded, setResourcesExpanded] = createSignal(true);
  const [createResourceDialogOpen, setCreateResourceDialogOpen] = createSignal(false);
  const [resources, setResources] = createSignal<Array<{ id: string; name: string; kind: "kv" | "secretStore" | "db"; status: string }>>([]);

  const loadResources = async () => {
    const [err, result] = await controller.apiService.api.resource.resources.list();
    if (err || !result) {
      application.notifyError(err?.message ?? "Resources are unavailable.");
      return;
    }
    setResources([...result]);
  };

  onSettled(() => {
    void loadResources();
    const unsubscribe = controller.invalidation.subscribe("resources", () => void loadResources());
    return unsubscribe;
  });

  const handleCreateResource = async (value: { kind: "kv" | "secretStore" | "db"; name: string }) => {
    const [err] = await controller.apiService.api.resource.resources.create(value);
    if (err) {
      application.notifyError(err.message);
      return false;
    }
    await loadResources();
    controller.invalidation.invalidate("resources");
    return true;
  };

  const handleOpenRenameDialog = (
    canvasId: string,
    canvasName: string,
    trigger: HTMLButtonElement,
  ) => {
    setCanvasToRename({ id: canvasId, name: canvasName });
    setRenameDialogTrigger(trigger);
    setRenameDialogOpen(true);
  };

  const handleOpenDeleteDialog = (canvas: TSidebarCanvas, trigger: HTMLButtonElement) => {
    setCanvasToDelete(canvas);
    setDeleteDialogTrigger(trigger);
    setDeleteDialogOpen(true);
  };

  const handleRename = async (newName: string) => {
    const canvas = canvasToRename();
    if (canvas) {
      const [err, data] = await controller.apiService.api.canvas.update({ params: { id: canvas.id }, body: { name: newName } });
      if (err) application.notifyError(err.message);
      if (data) {
        application.canvasUpdated(data);
      }
    }
  };

  const handleDeleted = async (result: TCanvasDeletionResult) => {
    const [listError, listed] = await controller.apiService.api.canvas.list();
    const remaining = listed ?? application.canvases().filter((canvas) => canvas.id !== result.canvas.id);
    application.canvasesReplaced(remaining);
    if (listError) {
      application.notifyError(
        "Canvas deleted, but the Canvas list could not be refreshed.",
        listError.message,
      );
    }
    const nextRoute = fnCanvasDeletionRoute({
      pathname: application.pathname(),
      deletedCanvasId: result.canvas.id,
      remainingCanvases: remaining,
    });
    if (nextRoute !== null) application.navigate(nextRoute, { replace: true });
    application.notifySuccess(
      "Canvas deleted",
      `${result.cleanup.retainedChatCount} retained chat histories were archived.`,
    );
  };

  const handleCreateCanvas = async (title: string) => {
    const [err, data] = await controller.apiService.api.canvas.create({ name: title });
    if (err) application.notifyError(err.message);
    if (data) {
      application.canvasCreated(data);
      application.navigate(`/c/${data.id}`);
    }
  };

  const isDarkTheme = () => {
    return application.themeAppearance() === "dark";
  };

  const handleThemeToggle = (pressed: boolean) => {
    application.setThemeAppearance(pressed ? "dark" : "light");
  };

  const sidebarClass = () => {
    return [styles.sidebar, props.visible === false ? styles.sidebarHidden : ""].filter(Boolean).join(" ");
  };

  return (
    <>
      <aside class={sidebarClass()} aria-label="Canvas navigation">
        <div class={styles.header}>
          <div class={styles.brandLockup}>
            <OmnidrawLogo class={styles.brandLogo} />
            <h1 class={styles.brand}>OMNIDRAW</h1>
          </div>
          <button
            type="button"
            class={styles.sidebarToggle}
            onClick={() => props.onToggleSidebar?.()}
            aria-label="Toggle sidebar"
          >
            <PanelLeft size={15} />
          </button>
        </div>

        <nav class={styles.nav} aria-label="Workspace navigation">
          <section class={styles.section}>
            <div class={styles.sectionHeader}>
              <button type="button" class={styles.sectionToggle} onClick={() => setCanvasesExpanded((value) => !value)} aria-expanded={canvasesExpanded() ? "true" : "false"}>
                <ChevronRight size={13} class={styles.sectionChevron} />
                <span class={styles.sectionTitle}>Canvases</span>
              </button>
              <div class={styles.sectionActions}>
                <button type="button" class={styles.sectionAdd} onClick={() => setCreateDialogOpen(true)} aria-label="Add canvas"><Plus size={14} /></button>
              </div>
            </div>

            <Show when={canvasesExpanded()}>
              <div class={styles.list}>
            <For
              each={application.canvases()}
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
                  onClick={() => application.navigate(`/c/${canvas.id}`)}
                  onRename={(trigger) => handleOpenRenameDialog(canvas.id, canvas.name, trigger)}
                  onDelete={(trigger) => handleOpenDeleteDialog(canvas, trigger)}
                />
              )}
            </For>
              </div>
            </Show>
          </section>

          <section class={styles.section}>
            <div class={styles.sectionHeader}>
              <button type="button" class={styles.sectionToggle} onClick={() => setResourcesExpanded((value) => !value)} aria-expanded={resourcesExpanded() ? "true" : "false"}>
                <ChevronRight size={13} class={styles.sectionChevron} />
                <span class={styles.sectionTitle}>Resources</span>
              </button>
              <div class={styles.sectionActions}>
                <button type="button" class={styles.sectionAdd} onClick={() => setCreateResourceDialogOpen(true)} aria-label="Add resource"><Plus size={14} /></button>
              </div>
            </div>

            <Show when={resourcesExpanded()}>
              <div class={styles.resourceList}>
                <For each={resources()} fallback={<p class={styles.emptyGroup}>No resources.</p>}>
                  {(resource) => (
                    <button
                      type="button"
                      class={`${styles.resourceItem} ${activeResourceId() === resource.id ? styles.resourceItemSelected : ""}`}
                      title={`${resource.kind} · ${resource.status}`}
                      aria-current={activeResourceId() === resource.id ? "page" : undefined}
                      onClick={() => application.navigate(`/resources/${resource.id}`)}
                    >
                      <span class={`${styles.resourceStatus} ${resource.status === "ready" ? styles.resourceStatusReady : ""}`} aria-hidden="true" />
                      <span class={styles.resourceName}>{resource.name}</span>
                      <span class={styles.resourceKind}>{resource.kind === "secretStore" ? "SECRET" : resource.kind.toUpperCase()}</span>
                    </button>
                  )}
                </For>
              </div>
            </Show>
          </section>

          <WidgetsSidebarSection controller={controller} />
        </nav>

        <div class={styles.footer}>
          <button
            type="button"
            aria-pressed={isDarkTheme() ? "true" : "false"}
            onClick={() => handleThemeToggle(!isDarkTheme())}
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
          </button>
        </div>
      </aside>

      <RenameDialog
        open={renameDialogOpen()}
        onOpenChange={setRenameDialogOpen}
        currentName={canvasToRename()?.name ?? ""}
        onRename={handleRename}
        returnFocus={renameDialogTrigger}
      />

      <DeleteCanvasDialog
        open={deleteDialogOpen()}
        onOpenChange={setDeleteDialogOpen}
        canvas={canvasToDelete()}
        createDeletionId={controller.browser.createIdempotencyKey}
        onPlan={(canvasId) => controller.apiService.api.canvas.deletionPlan({ canvasId })}
        onDelete={(args) => controller.apiService.api.canvas.remove(args)}
        onDeleted={handleDeleted}
        returnFocus={deleteDialogTrigger}
      />

      <CreateCanvasDialog
        open={createDialogOpen()}
        onOpenChange={setCreateDialogOpen}
        onCanvasCreated={handleCreateCanvas}
      />

      <CreateResourceDialog
        open={createResourceDialogOpen()}
        onOpenChange={setCreateResourceDialogOpen}
        onCreate={handleCreateResource}
      />

    </>
  );
};

export default Sidebar;
