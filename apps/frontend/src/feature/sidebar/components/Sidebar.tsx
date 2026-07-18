import { Button } from "@kobalte/core/button";
import * as ToggleButton from "@kobalte/core/toggle-button";
import { useLocation, useNavigate } from "@solidjs/router";
import { TOOL_GROUPS_CHANGED_EVENT } from "@vibecanvas/canvas/components/FloatingCanvasToolbar/CONSTANTS";
import DOMPurify from "dompurify";
import ChevronRight from "lucide-solid/icons/chevron-right";
import MoonStar from "lucide-solid/icons/moon-star";
import PanelLeft from "lucide-solid/icons/panel-left";
import Plus from "lucide-solid/icons/plus";
import Sun from "lucide-solid/icons/sun";
import * as LucideStatic from "lucide-static";
import type { Component } from "solid-js";
import { For, Show, createSignal, onCleanup, onMount } from "solid-js";
import { showErrorToast } from "@/components/ui/Toast";
import { removeFromCache } from "@/services/automerge";
import { orpcWebsocketService } from "@/services/orpc-websocket";
import { themeService, txSetThemeAppearance } from "@/services/theme";
import { setStore, store } from "@/store";
import type { TBackendCanvas } from "../../../types/backend.types";
import { CreateCanvasDialog } from "./CreateCanvasDialog";
import { CreateResourceDialog } from "./CreateResourceDialog";
import { RESOURCE_CATALOG_CHANGED_EVENT } from "./CONSTANTS";
import { DeleteCanvasDialog } from "./DeleteCanvasDialog";
import { RenameDialog } from "./RenameDialog";
import SidebarItem from "./SidebarItem";
import { ToolGroupDialog, type TToolGroupValue } from "./ToolGroupDialog";
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

  const activeResourceId = () => location.pathname.match(/^\/resources\/([^/]+)/)?.[1] ?? null;

  const [renameDialogOpen, setRenameDialogOpen] = createSignal(false);
  const [canvasToRename, setCanvasToRename] = createSignal<{
    id: string;
    name: string;
  } | null>(null);

  const [deleteDialogOpen, setDeleteDialogOpen] = createSignal(false);
  const [canvasToDelete, setCanvasToDelete] = createSignal<TBackendCanvas | null>(null);

  const [createDialogOpen, setCreateDialogOpen] = createSignal(false);
  const [canvasesExpanded, setCanvasesExpanded] = createSignal(true);
  const [groupsExpanded, setGroupsExpanded] = createSignal(true);
  const [resourcesExpanded, setResourcesExpanded] = createSignal(true);
  const [createResourceDialogOpen, setCreateResourceDialogOpen] = createSignal(false);
  const [resources, setResources] = createSignal<Array<{ id: string; name: string; kind: "kv" | "secretStore" | "db"; status: string }>>([]);
  const [toolGroups, setToolGroups] = createSignal<TToolGroupValue[]>([]);
  const [groupDialogOpen, setGroupDialogOpen] = createSignal(false);
  const [selectedGroup, setSelectedGroup] = createSignal<TToolGroupValue | null>(null);
  const [widgetGroups, setWidgetGroups] = createSignal<Array<{ name: string; group: string }>>([]);

  const loadToolGroups = async () => {
    const [err, groups] = await orpcWebsocketService.apiService.api.tool.groups.list();
    if (err) {
      showErrorToast(err.message);
      return;
    }
    setToolGroups(groups);
  };

  const loadWidgetGroups = async () => {
    const [listError, definitions] = await orpcWebsocketService.apiService.api.actors.definitions.list();
    if (listError) return;
    const results = await Promise.all(definitions.map((definition) =>
      orpcWebsocketService.apiService.api.actors.definitions.get({ name: definition.name })
    ));
    setWidgetGroups(results.flatMap(([, result]) => {
      if (!result) return [];
      const group = result?.def.widget?.tool?.group?.trim();
      return group ? [{ name: result.def.name, group }] : [];
    }));
  };

  const loadResources = async () => {
    const [err, result] = await orpcWebsocketService.apiService.api.actors.resources.list();
    if (err) {
      showErrorToast(err.message);
      return;
    }
    setResources(result);
  };

  onMount(() => {
    void loadToolGroups();
    void loadWidgetGroups();
    void loadResources();
    const handleResourceCatalogChange = () => void loadResources();
    window.addEventListener(RESOURCE_CATALOG_CHANGED_EVENT, handleResourceCatalogChange);
    onCleanup(() => window.removeEventListener(RESOURCE_CATALOG_CHANGED_EVENT, handleResourceCatalogChange));
  });

  const handleCreateResource = async (value: { kind: "kv" | "secretStore" | "db"; name: string }) => {
    const [err] = await orpcWebsocketService.apiService.api.actors.resources.create(value);
    if (err) {
      showErrorToast(err.message);
      return false;
    }
    await loadResources();
    window.dispatchEvent(new Event(RESOURCE_CATALOG_CHANGED_EVENT));
    return true;
  };

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

  const openCreateGroup = () => {
    setSelectedGroup(null);
    setGroupDialogOpen(true);
  };

  const openEditGroup = (group: TToolGroupValue) => {
    setSelectedGroup(group);
    setGroupDialogOpen(true);
  };

  const handleSaveGroup = async (group: TToolGroupValue) => {
    const current = selectedGroup();
    const [err] = current
      ? await orpcWebsocketService.apiService.api.tool.groups.update({ currentName: current.name, group })
      : await orpcWebsocketService.apiService.api.tool.groups.create(group);
    if (err) {
      showErrorToast(err.message);
      return false;
    }
    await loadToolGroups();
    document.defaultView?.dispatchEvent(new Event(TOOL_GROUPS_CHANGED_EVENT));
    return true;
  };

  const handleDeleteGroup = async () => {
    const current = selectedGroup();
    if (!current) return false;
    const [err] = await orpcWebsocketService.apiService.api.tool.groups.remove({ name: current.name });
    if (err) {
      showErrorToast(err.message);
      return false;
    }
    await loadToolGroups();
    document.defaultView?.dispatchEvent(new Event(TOOL_GROUPS_CHANGED_EVENT));
    return true;
  };

  const linkedWidgets = () => {
    const group = selectedGroup();
    return group ? widgetGroups().filter((widget) => widget.group === group.name).map((widget) => widget.name) : [];
  };

  const groupIconMarkup = (group: TToolGroupValue) => {
    const raw = group.json?.svgIcon?.trim()
      || (group.json?.lucidIcon ? (LucideStatic as Record<string, string>)[group.json.lucidIcon] : undefined);
    return raw ? DOMPurify.sanitize(raw, { USE_PROFILES: { svg: true, svgFilters: true } }) : "";
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

        <nav class={styles.nav} aria-label="Workspace navigation">
          <section class={styles.section}>
            <div class={styles.sectionHeader}>
              <Button class={styles.sectionToggle} onClick={() => setCanvasesExpanded((value) => !value)} aria-expanded={canvasesExpanded()}>
                <ChevronRight size={13} class={styles.sectionChevron} />
                <span class={styles.sectionTitle}>Canvases</span>
              </Button>
              <div class={styles.sectionActions}>
                <Button class={styles.sectionAdd} onClick={() => setCreateDialogOpen(true)} aria-label="Add canvas"><Plus size={14} /></Button>
              </div>
            </div>

            <Show when={canvasesExpanded()}>
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
            </Show>
          </section>

          <section class={styles.section}>
            <div class={styles.sectionHeader}>
              <Button class={styles.sectionToggle} onClick={() => setResourcesExpanded((value) => !value)} aria-expanded={resourcesExpanded()}>
                <ChevronRight size={13} class={styles.sectionChevron} />
                <span class={styles.sectionTitle}>Resources</span>
              </Button>
              <div class={styles.sectionActions}>
                <Button class={styles.sectionAdd} onClick={() => setCreateResourceDialogOpen(true)} aria-label="Add resource"><Plus size={14} /></Button>
              </div>
            </div>

            <Show when={resourcesExpanded()}>
              <div class={styles.resourceList}>
                <For each={resources()} fallback={<p class={styles.emptyGroup}>No resources.</p>}>
                  {(resource) => (
                    <Button
                      class={`${styles.resourceItem} ${activeResourceId() === resource.id ? styles.resourceItemSelected : ""}`}
                      title={`${resource.kind} · ${resource.status}`}
                      aria-current={activeResourceId() === resource.id ? "page" : undefined}
                      onClick={() => navigate(`/resources/${resource.id}`)}
                    >
                      <span class={`${styles.resourceStatus} ${resource.status === "ready" ? styles.resourceStatusReady : ""}`} aria-hidden="true" />
                      <span class={styles.resourceName}>{resource.name}</span>
                      <span class={styles.resourceKind}>{resource.kind === "secretStore" ? "SECRET" : resource.kind.toUpperCase()}</span>
                    </Button>
                  )}
                </For>
              </div>
            </Show>
          </section>

          <section class={styles.section}>
            <div class={styles.sectionHeader}>
              <Button class={styles.sectionToggle} onClick={() => setGroupsExpanded((value) => !value)} aria-expanded={groupsExpanded()}>
                <ChevronRight size={13} class={styles.sectionChevron} />
                <span class={styles.sectionTitle}>Tool Groups</span>
              </Button>
              <div class={styles.sectionActions}>
                <Button class={styles.sectionAdd} onClick={openCreateGroup} aria-label="Add tool group"><Plus size={14} /></Button>
              </div>
            </div>

            <Show when={groupsExpanded()}>
              <div class={styles.groupList}>
                <For each={toolGroups()} fallback={<p class={styles.emptyGroup}>No tool groups.</p>}>
                  {(group) => (
                    <Button class={styles.groupItem} onClick={() => openEditGroup(group)}>
                      <Show when={groupIconMarkup(group)}>
                        {(markup) => <span class={styles.groupIcon} innerHTML={markup()} aria-hidden="true" />}
                      </Show>
                      <span class={styles.groupName}>{group.name}</span>
                    </Button>
                  )}
                </For>
              </div>
            </Show>
          </section>
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

      <CreateResourceDialog
        open={createResourceDialogOpen()}
        onOpenChange={setCreateResourceDialogOpen}
        onCreate={handleCreateResource}
      />

      <ToolGroupDialog
        open={groupDialogOpen()}
        onOpenChange={setGroupDialogOpen}
        group={selectedGroup()}
        linkedWidgets={linkedWidgets()}
        onSave={handleSaveGroup}
        onDelete={handleDeleteGroup}
      />
    </>
  );
};

export default Sidebar;
