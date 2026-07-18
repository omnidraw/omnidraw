import { Button } from '@kobalte/core/button';
import { DropdownMenu } from '@kobalte/core/dropdown-menu';
import { useLocation, useNavigate } from '@solidjs/router';
import { TOOL_GROUPS_CHANGED_EVENT } from '@vibecanvas/canvas/components/FloatingCanvasToolbar/CONSTANTS';
import ChevronRight from 'lucide-solid/icons/chevron-right';
import MoreHorizontal from 'lucide-solid/icons/more-horizontal';
import Pencil from 'lucide-solid/icons/pencil';
import TriangleAlert from 'lucide-solid/icons/triangle-alert';
import { For, Show, createMemo, createSignal, type Component } from 'solid-js';
import { showErrorToast } from '@/components/ui/Toast';
import { ToolGroupDialog, type TToolGroupValue } from '@/feature/sidebar/components/ToolGroupDialog';
import { orpcWebsocketService } from '@/services/orpc-websocket';
import { fnProjectWidgetCatalog, fnWidgetSelection } from '../fn.widget-catalog';
import { useWidgetCatalog } from '../WidgetCatalogProvider';
import type { TWidgetSidebarGroup, TWidgetSidebarRow } from '../types';
import { WidgetIcon } from './WidgetIcon';
import styles from './WidgetsSidebarSection.module.css';

export const WidgetsSidebarSection: Component = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const catalogState = useWidgetCatalog();
  const [expanded, setExpanded] = createSignal(true);
  const [expandedGroups, setExpandedGroups] = createSignal<Set<string>>(new Set());
  const [dialogOpen, setDialogOpen] = createSignal(false);
  const [selectedGroup, setSelectedGroup] = createSignal<TWidgetSidebarGroup | null>(null);
  const projection = createMemo(() => catalogState.catalog() ? fnProjectWidgetCatalog(catalogState.catalog()!) : null);
  const selection = createMemo(() => fnWidgetSelection(location.pathname));

  const selectedName = () => {
    const selected = selection();
    if (!selected) return null;
    try { return decodeURIComponent(selected.encodedName); } catch { return null; }
  };
  const isSelected = (row: TWidgetSidebarRow) => selection()?.source === row.source && selectedName() === row.name;
  const openRow = (row: TWidgetSidebarRow) => navigate(`/widgets/${row.source}/${encodeURIComponent(row.name)}?tab=overview`);
  const toggleGroup = (name: string) => setExpandedGroups((current) => {
    const next = new Set(current);
    if (next.has(name)) next.delete(name); else next.add(name);
    return next;
  });
  const openCreate = () => { setSelectedGroup(null); setDialogOpen(true); };
  const openEdit = (group: TWidgetSidebarGroup) => { setSelectedGroup(group); setDialogOpen(true); };
  const linkedWidgets = () => {
    const selected = selectedGroup();
    if (!selected) return [];
    return catalogState.catalog()?.widgets.flatMap((widget) => [widget.published, widget.draft]
      .filter((variant) => variant?.tool.group === selected.name)
      .map((variant) => `${variant!.displayName} (${variant!.source})`)) ?? [];
  };

  const saveGroup = async (group: TToolGroupValue) => {
    const current = selectedGroup();
    const [error] = current
      ? await orpcWebsocketService.apiService.api.agent.widgets.groups.update({ currentName: current.name, group: { name: group.name, icon: group.json } })
      : await orpcWebsocketService.apiService.api.agent.widgets.groups.create({ name: group.name, icon: group.json });
    if (error) { showErrorToast(error.message); return false; }
    await catalogState.refresh();
    window.dispatchEvent(new Event(TOOL_GROUPS_CHANGED_EVENT));
    return true;
  };

  const deleteGroup = async () => {
    const current = selectedGroup();
    if (!current) return false;
    const [error] = await orpcWebsocketService.apiService.api.agent.widgets.groups.remove({ name: current.name });
    if (error) { showErrorToast(error.message); return false; }
    await catalogState.refresh();
    window.dispatchEvent(new Event(TOOL_GROUPS_CHANGED_EVENT));
    return true;
  };

  const row = (value: TWidgetSidebarRow) => (
    <Button
      class={`${styles.widgetRow} ${isSelected(value) ? styles.selected : ''}`}
      aria-current={isSelected(value) ? 'page' : undefined}
      title={value.problem?.message ?? (value.missingGroup ? `Missing tool group: ${value.missingGroup}` : undefined)}
      onClick={() => openRow(value)}
    >
      <WidgetIcon icon={value.variant.tool.icon} class={styles.icon} />
      <span class={styles.widgetName}>{value.variant.displayName}</span>
      <Show when={value.source === 'draft'}><span class={styles.draftBadge}><Pencil size={9} /> Draft</span></Show>
      <Show when={value.problem || value.missingGroup}><TriangleAlert class={styles.warning} size={12} aria-label={value.problem ? 'Widget problem' : 'Missing tool group'} /></Show>
    </Button>
  );

  return (
    <section class={styles.section}>
      <div class={styles.header}>
        <Button class={styles.sectionToggle} onClick={() => setExpanded((value) => !value)} aria-expanded={expanded()}>
          <ChevronRight size={13} class={styles.chevron} />
          <span>Widgets</span>
        </Button>
        <DropdownMenu modal={false}>
          <DropdownMenu.Trigger class={styles.menuTrigger} aria-label="Widget section actions"><MoreHorizontal size={14} /></DropdownMenu.Trigger>
          <DropdownMenu.Portal><DropdownMenu.Content class={styles.menu}><DropdownMenu.Item class={styles.menuItem} onSelect={openCreate}>Create tool group</DropdownMenu.Item></DropdownMenu.Content></DropdownMenu.Portal>
        </DropdownMenu>
      </div>
      <Show when={expanded()}>
        <div class={styles.body}>
          <Show when={catalogState.loading()}><p class={styles.state}>Loading widgets…</p></Show>
          <Show when={catalogState.error()}>{(message) => <p class={styles.error} title={message()}>{message()}</p>}</Show>
          <Show when={projection()}>
            {(projected) => <>
              <For each={projected().groups}>{(group) => <div>
                <div class={styles.groupRow}>
                  <Button class={styles.groupToggle} onClick={() => toggleGroup(group.name)} aria-expanded={expandedGroups().has(group.name)} aria-label={`${expandedGroups().has(group.name) ? 'Collapse' : 'Expand'} ${group.name}`}><ChevronRight size={12} /></Button>
                  <WidgetIcon icon={group.icon} class={styles.icon} />
                  <span class={styles.groupName}>{group.name}</span>
                  <DropdownMenu modal={false}>
                    <DropdownMenu.Trigger class={styles.groupMenuTrigger} aria-label={`Actions for ${group.name}`}><MoreHorizontal size={13} /></DropdownMenu.Trigger>
                    <DropdownMenu.Portal><DropdownMenu.Content class={styles.menu}><DropdownMenu.Item class={styles.menuItem} onSelect={() => openEdit(group)}>Edit group</DropdownMenu.Item></DropdownMenu.Content></DropdownMenu.Portal>
                  </DropdownMenu>
                </div>
                <Show when={expandedGroups().has(group.name)}><div class={styles.groupChildren}><For each={group.rows} fallback={<p class={styles.empty}>Empty group</p>}>{row}</For></div></Show>
              </div>}</For>
              <For each={projected().ungrouped}>{row}</For>
              <Show when={projected().groups.length === 0 && projected().ungrouped.length === 0}><p class={styles.state}>No widgets yet.</p></Show>
            </>}
          </Show>
        </div>
      </Show>
      <ToolGroupDialog
        open={dialogOpen()}
        onOpenChange={setDialogOpen}
        group={selectedGroup() ? { name: selectedGroup()!.name, json: selectedGroup()!.icon } : null}
        linkedWidgets={linkedWidgets()}
        onSave={saveGroup}
        onDelete={deleteGroup}
      />
    </section>
  );
};
