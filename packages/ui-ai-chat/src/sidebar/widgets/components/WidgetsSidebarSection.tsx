import { Button } from '@kobalte/core/button';
import { DropdownMenu } from '@kobalte/core/dropdown-menu';
import ChevronRight from 'lucide-solid/icons/chevron-right';
import MoreHorizontal from 'lucide-solid/icons/more-horizontal';
import Pencil from 'lucide-solid/icons/pencil';
import TriangleAlert from 'lucide-solid/icons/triangle-alert';
import { For, Show, createEffect, createMemo, createSignal, onCleanup, type Component } from 'solid-js';
import { ToolGroupDialog, type TToolGroupValue } from '../../components/ToolGroupDialog';
import { fnFindWidgetSelectionGroup, fnProjectWidgetCatalog, fnWidgetSelection } from '../fn.widget-catalog';
import { useWidgetCatalog } from '../WidgetCatalogProvider';
import type { TWidgetSidebarGroup, TWidgetSidebarRow } from '../types';
import { WidgetIcon } from './WidgetIcon';
import styles from './WidgetsSidebarSection.module.css';
import type { TSidebarController } from '../../ports';

export const WidgetsSidebarSection: Component<{ controller: TSidebarController }> = (props) => {
  const application = props.controller.application;
  const catalogState = useWidgetCatalog();
  const [expanded, setExpanded] = createSignal(true);
  const [expandedGroups, setExpandedGroups] = createSignal<Set<string>>(new Set());
  const [dialogOpen, setDialogOpen] = createSignal(false);
  const [selectedGroup, setSelectedGroup] = createSignal<TWidgetSidebarGroup | null>(null);
  const [placementAvailable, setPlacementAvailable] = createSignal(
    props.controller.widgetPlacement?.available() ?? false,
  );
  const projection = createMemo(() => catalogState.catalog() ? fnProjectWidgetCatalog(catalogState.catalog()!) : null);
  const selection = createMemo(() => fnWidgetSelection(application.pathname()));
  const unsubscribePlacement = props.controller.widgetPlacement?.subscribe?.(
    setPlacementAvailable,
  );
  onCleanup(() => unsubscribePlacement?.());

  const selectedName = createMemo(() => {
    const selected = selection();
    if (!selected) return null;
    try { return decodeURIComponent(selected.encodedName); } catch { return null; }
  });
  const isSelected = (row: TWidgetSidebarRow) => selection()?.source === row.managementSource && selectedName() === row.name;
  const openRow = (row: TWidgetSidebarRow) => application.navigate(`/widgets/${row.managementSource}/${encodeURIComponent(row.name)}?tab=overview`);
  const toggleGroup = (name: string) => setExpandedGroups((current) => {
    const next = new Set(current);
    if (next.has(name)) next.delete(name); else next.add(name);
    return next;
  });
  const openCreate = () => { setSelectedGroup(null); setDialogOpen(true); };
  const openEdit = (group: TWidgetSidebarGroup) => { setSelectedGroup(group); setDialogOpen(true); };

  createEffect(() => {
    const selected = selection();
    const name = selectedName();
    const projected = projection();
    if (!selected || !name || !projected) return;
    const groupName = fnFindWidgetSelectionGroup(projected, selected.source, name);
    if (!groupName) return;
    setExpandedGroups((current) => {
      if (current.has(groupName)) return current;
      const next = new Set(current);
      next.add(groupName);
      return next;
    });
  });

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
      ? await props.controller.apiService.api.agent.widgets.groups.update({ currentName: current.name, group: { name: group.name, icon: group.json } })
      : await props.controller.apiService.api.agent.widgets.groups.create({ name: group.name, icon: group.json });
    if (error) { application.notifyError(error.message); return false; }
    await catalogState.refresh();
    props.controller.invalidation.invalidate('toolbar-groups');
    return true;
  };

  const deleteGroup = async () => {
    const current = selectedGroup();
    if (!current) return false;
    const [error] = await props.controller.apiService.api.agent.widgets.groups.remove({ name: current.name });
    if (error) { application.notifyError(error.message); return false; }
    await catalogState.refresh();
    props.controller.invalidation.invalidate('toolbar-groups');
    return true;
  };

  const row = (value: TWidgetSidebarRow) => {
    let suppressClick = false;
    const disabledReason = value.problem?.message
      ?? (value.missingGroup ? `Missing tool group: ${value.missingGroup}` : null)
      ?? (!value.placement ? 'Widget placement is unavailable.' : null);
    const label = value.variant.tool.label ?? value.variant.displayName;
    const addToCanvas = async () => {
      if (!value.placement) return;
      try {
        if (!props.controller.widgetPlacement) throw new Error('Open a canvas before placing a widget.');
        await props.controller.widgetPlacement.addToCanvas({
          reference: value.placement.reference,
          bounds: value.placement.bounds,
          label,
        });
      } catch (error) {
        application.notifyError(error instanceof Error ? error.message : String(error));
      }
    };
    return (
      <div class={`${styles.widgetRow} ${value.source === 'draft' ? styles.draftRow : ''} ${isSelected(value) ? styles.selected : ''}`}>
        <Button
          class={`${styles.widgetRowMain} ${isSelected(value) ? styles.selected : ''}`}
          aria-current={isSelected(value) ? 'page' : undefined}
          aria-label={`${value.variant.displayName}, ${value.source}. ${value.source === 'draft' ? 'Dragging builds a pinned Preview.' : 'Drag to place on canvas.'}`}
          title={disabledReason ?? `Drag ${label} to the canvas`}
          onPointerDown={(event) => {
            if (!value.placement || !props.controller.widgetPlacement?.available()) return;
            props.controller.widgetPlacement.beginPointerSession({
              reference: value.placement.reference,
              bounds: value.placement.bounds,
              label,
              event,
              onDragStart: () => { suppressClick = true; },
              onDragEnd: () => {
                props.controller.browser.setTimeout(() => { suppressClick = false; }, 0);
              },
            });
          }}
          onClick={() => {
            if (suppressClick) {
              suppressClick = false;
              return;
            }
            openRow(value);
          }}
        >
          <WidgetIcon icon={value.variant.tool.icon} class={styles.icon} />
          <span class={styles.widgetName}>{value.variant.displayName}</span>
          <Show when={value.source === 'draft'}><span class={styles.draftBadge}><Pencil size={9} /> Draft</span></Show>
          <Show when={value.problem || value.missingGroup}><TriangleAlert class={styles.warning} size={12} aria-label={value.problem ? 'Widget problem' : 'Missing tool group'} /></Show>
        </Button>
        <Show when={placementAvailable() && value.placement}>
          <Button
            class={`${styles.addButton} ${value.source === 'draft' ? styles.draftAddButton : ''}`}
            aria-label={`Add ${label} ${value.source} to canvas`}
            title={disabledReason ?? 'Add to canvas'}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              void addToCanvas();
            }}
          >
            Add to canvas
          </Button>
        </Show>
      </div>
    );
  };

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
                  <Button
                    class={styles.groupDisclosure}
                    onClick={() => toggleGroup(group.name)}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter' && event.key !== ' ') return;
                      event.preventDefault();
                      toggleGroup(group.name);
                    }}
                    aria-expanded={expandedGroups().has(group.name)}
                    aria-label={`${expandedGroups().has(group.name) ? 'Collapse' : 'Expand'} ${group.name} tool group`}
                  >
                    <ChevronRight size={12} class={styles.groupChevron} />
                    <WidgetIcon icon={group.icon} class={styles.icon} />
                    <span class={styles.groupName}>{group.name}</span>
                  </Button>
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
