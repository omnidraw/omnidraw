import { Button } from '@kobalte/core/button';
import { DropdownMenu } from '@kobalte/core/dropdown-menu';
import ChevronRight from 'lucide-solid/icons/chevron-right';
import MoreHorizontal from 'lucide-solid/icons/more-horizontal';
import Pencil from 'lucide-solid/icons/pencil';
import Plus from 'lucide-solid/icons/plus';
import TriangleAlert from 'lucide-solid/icons/triangle-alert';
import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  type Component,
} from 'solid-js';
import {
  fnFindWidgetSelectionGroup,
  fnProjectWidgetCatalog,
  fnWidgetSelection,
} from '../fn.widget-catalog';
import { useWidgetCatalog } from '../WidgetCatalogProvider';
import type { TWidgetSidebarRow } from '../types';
import { WidgetIcon } from './WidgetIcon';
import styles from './WidgetsSidebarSection.module.css';
import type { TSidebarController } from '../../ports';

export const WidgetsSidebarSection: Component<{ controller: TSidebarController }> = (props) => {
  const application = props.controller.application;
  const catalogState = useWidgetCatalog();
  const [expanded, setExpanded] = createSignal(true);
  const [expandedGroups, setExpandedGroups] = createSignal<Set<string>>(new Set());
  const [placementAvailable, setPlacementAvailable] = createSignal(
    props.controller.widgetPlacement?.available() ?? false,
  );
  const projection = createMemo(() => {
    const catalog = catalogState.catalog();
    return catalog ? fnProjectWidgetCatalog(catalog) : null;
  });
  const selection = createMemo(() => fnWidgetSelection(application.pathname()));
  const unsubscribePlacement = props.controller.widgetPlacement?.subscribe?.(setPlacementAvailable);
  onCleanup(() => unsubscribePlacement?.());

  const selectedWidgetKey = createMemo(() => {
    const selected = selection();
    if (!selected) return null;
    try {
      return decodeURIComponent(selected.encodedWidgetKey);
    } catch {
      return null;
    }
  });
  const isSelected = (row: TWidgetSidebarRow) => (
    selection()?.source === row.source && selectedWidgetKey() === row.widgetKey
  );
  const openRow = (row: TWidgetSidebarRow) => application.navigate(
    `/widgets/${row.source}/${encodeURIComponent(row.widgetKey)}?tab=overview`,
  );
  const toggleGroup = (name: string) => setExpandedGroups((current) => {
    const next = new Set(current);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    return next;
  });

  createEffect(() => {
    const selected = selection();
    const widgetKey = selectedWidgetKey();
    const projected = projection();
    if (!selected || !widgetKey || !projected) return;
    const groupName = fnFindWidgetSelectionGroup(projected, selected.source, widgetKey);
    if (!groupName) return;
    setExpandedGroups((current) => {
      if (current.has(groupName)) return current;
      const next = new Set(current);
      next.add(groupName);
      return next;
    });
  });

  const row = (value: TWidgetSidebarRow) => {
    let suppressClick = false;
    const label = value.form.config?.tool.label
      ?? value.form.config?.name
      ?? value.widgetKey;
    const displayName = value.form.config?.name ?? value.widgetKey;
    const disabledReason = value.problem?.message
      ?? (!value.placement ? 'This source cannot be placed.' : null);
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
    return <div class={`${styles.widgetRow} ${value.source === 'draft' ? styles.draftRow : ''} ${isSelected(value) ? styles.selected : ''}`}>
      <Button
        class={`${styles.widgetRowMain} ${isSelected(value) ? styles.selected : ''}`}
        aria-current={isSelected(value) ? 'page' : undefined}
        aria-label={`${displayName}, ${value.source}, ${value.form.health}.`}
        title={value.problem?.message ?? `Open ${displayName}`}
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
        <WidgetIcon icon={value.form.config?.tool.icon ?? null} class={styles.icon} />
        <span class={styles.widgetName}>{displayName}</span>
        <Show when={value.source === 'draft'}>
          <span class={styles.draftBadge}><Pencil size={9} /> Draft</span>
        </Show>
        <Show when={value.problem}>
          <TriangleAlert class={styles.warning} size={12} aria-label="Widget problem" />
        </Show>
      </Button>
      <Show when={placementAvailable() && value.placement}>
        <Button
          class={`${styles.addButton} ${value.source === 'draft' ? styles.draftAddButton : ''}`}
          aria-label={value.action === 'add' ? `Add ${label} to canvas` : `Preview ${label} on canvas`}
          title={disabledReason ?? (value.action === 'add' ? 'Add to canvas' : 'Place a live Preview frame')}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            void addToCanvas();
          }}
        >{value.action === 'add' ? <><Plus size={10} /><span>Add</span></> : 'Preview'}</Button>
      </Show>
    </div>;
  };

  return <section class={styles.section}>
    <div class={styles.header}>
      <Button
        class={styles.sectionToggle}
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded()}
      >
        <ChevronRight size={13} class={styles.chevron} />
        <span>Widgets</span>
      </Button>
      <DropdownMenu modal={false}>
        <DropdownMenu.Trigger class={styles.menuTrigger} aria-label="Widget section actions">
          <MoreHorizontal size={14} />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal><DropdownMenu.Content class={styles.menu}>
          <DropdownMenu.Item class={styles.menuItem} onSelect={() => void catalogState.refresh()}>
            Refresh widget folders
          </DropdownMenu.Item>
        </DropdownMenu.Content></DropdownMenu.Portal>
      </DropdownMenu>
    </div>
    <Show when={expanded()}>
      <div class={styles.body}>
        <Show when={catalogState.loading()}><p class={styles.state}>Loading widgets…</p></Show>
        <Show when={catalogState.error()}>{(message) => (
          <p class={styles.error} role="alert" title={message()}>{message()}</p>
        )}</Show>
        <Show when={projection()}>{(projected) => <>
          <For each={projected().groups}>{(group) => <div>
            <div class={styles.groupRow}>
              <Button
                class={styles.groupDisclosure}
                onClick={() => toggleGroup(group.name)}
                aria-expanded={expandedGroups().has(group.name)}
                aria-label={`${expandedGroups().has(group.name) ? 'Collapse' : 'Expand'} ${group.name} widget group`}
              >
                <ChevronRight size={12} class={styles.groupChevron} />
                <span class={styles.groupName}>{group.name}</span>
              </Button>
            </div>
            <Show when={expandedGroups().has(group.name)}>
              <div class={styles.groupChildren}>
                <For each={group.rows}>{row}</For>
              </div>
            </Show>
          </div>}</For>
          <For each={projected().ungrouped}>{row}</For>
          <Show when={projected().groups.length === 0 && projected().ungrouped.length === 0}>
            <p class={styles.state}>No widget folders found.</p>
          </Show>
        </>}</Show>
      </div>
    </Show>
  </section>;
};
