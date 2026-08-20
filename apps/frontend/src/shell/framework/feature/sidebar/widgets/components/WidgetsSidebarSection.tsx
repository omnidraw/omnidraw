import {
  ChevronRight,
  MoreHorizontal,
  Plus,
  TriangleAlert,
} from '@/shell/framework/components/icons';
import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  createUniqueId,
  onSettled,
  untrack,
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
  const application = untrack(() => props.controller.application);
  const browser = untrack(() => props.controller.browser);
  const widgetPlacement = untrack(() => props.controller.widgetPlacement);
  const catalogState = useWidgetCatalog();
  const [expanded, setExpanded] = createSignal(true);
  const [expandedGroups, setExpandedGroups] = createSignal<Set<string>>(new Set());
  const [placementAvailable, setPlacementAvailable] = createSignal(
    widgetPlacement?.available() ?? false,
  );
  const [actionsOpen, setActionsOpen] = createSignal(false);
  const actionsTriggerId = createUniqueId();
  let actionsRoot: HTMLDivElement | undefined;
  let actionsTrigger: HTMLButtonElement | undefined;
  let actionsMenu: HTMLDivElement | undefined;
  const projection = createMemo(() => {
    const catalog = catalogState.catalog();
    return catalog ? fnProjectWidgetCatalog(catalog) : null;
  });
  const selection = createMemo(() => fnWidgetSelection(application.pathname()));
  onSettled(() => {
    const unsubscribePlacement = widgetPlacement?.subscribe?.(setPlacementAvailable);
    const handlePointerDown = (event: PointerEvent) => {
      if (actionsRoot?.contains(event.target as Node)) return;
      setActionsOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !actionsOpen()) return;
      event.preventDefault();
      setActionsOpen(false);
      actionsTrigger?.focus();
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      unsubscribePlacement?.();
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  });

  createEffect(
    () => actionsOpen(),
    (open) => {
      if (open) queueMicrotask(() => actionsMenu?.querySelector<HTMLElement>('[role="menuitem"]')?.focus());
    },
  );

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

  createEffect(
    () => {
      const selected = selection();
      const widgetKey = selectedWidgetKey();
      const projected = projection();
      return selected !== null && widgetKey !== null && projected !== null
        ? fnFindWidgetSelectionGroup(projected, selected.source, widgetKey)
        : null;
    },
    (groupName) => {
      if (groupName === null) return;
      setExpandedGroups((current) => {
        if (current.has(groupName)) return current;
        const next = new Set(current);
        next.add(groupName);
        return next;
      });
    },
  );

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
        if (!widgetPlacement) throw new Error('Open a canvas before placing a widget.');
        await widgetPlacement.addToCanvas({
          reference: value.placement.reference,
          bounds: value.placement.bounds,
          label,
        });
      } catch (error) {
        application.notifyError(error instanceof Error ? error.message : String(error));
      }
    };
    return <div class={`${styles.widgetRow} ${value.source === 'draft' ? styles.draftRow : ''} ${isSelected(value) ? styles.selected : ''}`}>
      <button
        type="button"
        class={`${styles.widgetRowMain} ${isSelected(value) ? styles.selected : ''}`}
        aria-current={isSelected(value) ? 'page' : undefined}
        aria-label={`${displayName}, ${value.source}, ${value.form.health}.`}
        title={value.problem?.message ?? `Open ${displayName}`}
        onPointerDown={(event) => {
          if (!value.placement || !widgetPlacement?.available()) return;
          widgetPlacement.beginPointerSession({
            reference: value.placement.reference,
            bounds: value.placement.bounds,
            label,
            event,
            onDragStart: () => { suppressClick = true; },
            onDragEnd: () => {
              browser.setTimeout(() => { suppressClick = false; }, 0);
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
        <Show when={value.problem}>
          <TriangleAlert class={styles.warning} size={12} aria-label="Widget problem" />
        </Show>
      </button>
      <Show when={placementAvailable() && value.placement}>
        <button
          type="button"
          class={`${styles.addButton} ${value.source === 'draft' ? styles.draftAddButton : ''}`}
          aria-label={value.action === 'add' ? `Add ${label} to canvas` : `Add ${label} draft to canvas`}
          title={disabledReason ?? (value.action === 'add' ? 'Add to canvas' : 'Add draft to canvas')}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            void addToCanvas();
          }}
        ><Plus size={10} /><span>{value.action === 'add' ? 'Add' : 'Add draft'}</span></button>
      </Show>
    </div>;
  };

  return <section class={styles.section}>
    <div ref={(element) => { actionsRoot = element; }} class={styles.header}>
      <button
        type="button"
        class={styles.sectionToggle}
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded() ? 'true' : 'false'}
      >
        <ChevronRight size={13} class={styles.chevron} />
        <span>Widgets</span>
      </button>
      <div>
        <button
          type="button"
          id={actionsTriggerId}
          ref={(element) => { actionsTrigger = element; }}
          class={styles.menuTrigger}
          aria-label="Widget section actions"
          aria-haspopup="menu"
          aria-expanded={actionsOpen() ? 'true' : 'false'}
          onClick={() => setActionsOpen((open) => !open)}
        >
          <MoreHorizontal size={14} />
        </button>
        <Show when={actionsOpen()}><div
          ref={(element) => { actionsMenu = element; }}
          class={styles.menu}
          role="menu"
          aria-labelledby={actionsTriggerId}
          onFocusOut={(event) => {
            const next = event.relatedTarget;
            if (next instanceof Node && event.currentTarget.contains(next)) return;
            setActionsOpen(false);
          }}
          onKeyDown={(event) => {
            if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const items = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]')];
            if (items.length === 0) return;
            const current = items.indexOf(document.activeElement as HTMLElement);
            const next = event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? items.length - 1
                : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
            items[next]?.focus();
          }}
        >
          <button
            type="button"
            role="menuitem"
            class={styles.menuItem}
            onClick={() => {
              setActionsOpen(false);
              void catalogState.refresh();
            }}
          >
            Refresh widget folders
          </button>
        </div></Show>
      </div>
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
              <button
                type="button"
                class={styles.groupDisclosure}
                onClick={() => toggleGroup(group.name)}
                aria-expanded={expandedGroups().has(group.name) ? 'true' : 'false'}
                aria-label={`${expandedGroups().has(group.name) ? 'Collapse' : 'Expand'} ${group.name} widget group`}
              >
                <ChevronRight size={12} class={styles.groupChevron} />
                <span class={styles.groupName}>{group.name}</span>
              </button>
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
