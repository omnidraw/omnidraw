import type { TWidgetCatalog, TWidgetVariantSummary } from '@omnidraw/orpc-client';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { createCatalogInvalidation } from '../../src/sidebar/ports';
import { WidgetCatalogProvider } from '../../src/sidebar/widgets/WidgetCatalogProvider';
import { WidgetsSidebarSection } from '../../src/sidebar/widgets/components/WidgetsSidebarSection';
import styles from '../../src/sidebar/widgets/components/WidgetsSidebarSection.module.css';

let dispose: (() => void) | undefined;
let host: HTMLDivElement | undefined;

function variant(source: 'published' | 'draft'): TWidgetVariantSummary {
  return {
    source,
    displayName: 'Camera',
    kind: 'notes-widget',
    slug: 'camera',
    description: null,
    revision: source,
    contentFingerprint: source,
    updatedAt: null,
    tool: { label: 'Camera', icon: null, group: 'Media', priority: null, behaviorType: 'action' },
    validation: source === 'draft' ? { status: 'unknown', errors: [], warnings: [] } : null,
    placement: {
      reference: { source, name: 'Camera', revision: source },
      bounds: { width: 360, height: 320 },
    },
  };
}

function catalog(): TWidgetCatalog {
  return {
    generation: 'selection-test',
    groups: [{ name: 'Media', icon: null }],
    widgets: [{
      name: 'Camera',
      relation: 'different',
      published: variant('published'),
      draft: variant('draft'),
      problem: null,
    }],
  };
}

function controller(pathname: () => string) {
  return {
    apiService: {
      api: {
        agent: {
          events: vi.fn(async () => [null, { async *[Symbol.asyncIterator]() {} }]),
          widgets: {
            catalog: vi.fn(async () => [null, catalog()]),
            groups: {
              create: vi.fn(async () => [null, undefined]),
              update: vi.fn(async () => [null, undefined]),
              remove: vi.fn(async () => [null, undefined]),
            },
          },
        },
      },
    },
    browser: {
      setTimeout: (callback: () => void, timeout: number) => window.setTimeout(callback, timeout),
      clearTimeout: (timer: unknown) => window.clearTimeout(timer as number),
    },
    invalidation: createCatalogInvalidation(),
    application: {
      pathname,
      navigate: vi.fn(),
      notifyError: vi.fn(),
    },
  } as never;
}

function keyboardClick(button: HTMLButtonElement, key: 'Enter' | ' ') {
  button.focus();
  const keydown = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key });
  button.dispatchEvent(keydown);
  button.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key }));
  if (!keydown.defaultPrevented) button.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
}

afterEach(() => {
  dispose?.();
  dispose = undefined;
  host?.remove();
  host = undefined;
});

describe('WidgetsSidebarSection selection', () => {
  test('uses the whole group disclosure while keeping its actions menu independent', async () => {
    const sectionController = controller(() => '/c/canvas-1');
    const container = document.createElement('div');
    host = container;
    document.body.appendChild(container);
    dispose = render(() => (
      <WidgetCatalogProvider controller={sectionController}>
        <WidgetsSidebarSection controller={sectionController} />
      </WidgetCatalogProvider>
    ), container);

    const disclosure = await vi.waitFor(() => {
      const button = container.querySelector<HTMLButtonElement>('button[aria-label="Expand Media tool group"]');
      expect(button).not.toBeNull();
      return button!;
    });
    const isExpanded = () => disclosure.getAttribute('aria-expanded') === 'true';
    const visibleRows = () => container.querySelectorAll(`.${styles.groupChildren} .${styles.widgetRow}`).length;

    expect(disclosure.tagName).toBe('BUTTON');
    expect(isExpanded()).toBe(false);
    expect(visibleRows()).toBe(0);

    disclosure.querySelector<SVGElement>('svg')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(isExpanded()).toBe(true);
    expect(visibleRows()).toBe(2);

    disclosure.querySelector<HTMLElement>(`.${styles.groupName}`)?.click();
    expect(isExpanded()).toBe(false);
    expect(visibleRows()).toBe(0);

    disclosure.querySelector<HTMLElement>(`.${styles.icon}`)?.click();
    expect(isExpanded()).toBe(true);
    disclosure.click();
    expect(isExpanded()).toBe(false);

    keyboardClick(disclosure, 'Enter');
    expect(isExpanded()).toBe(true);
    expect(visibleRows()).toBe(2);
    keyboardClick(disclosure, ' ');
    expect(isExpanded()).toBe(false);
    expect(visibleRows()).toBe(0);

    const menuTrigger = container.querySelector<HTMLButtonElement>('button[aria-label="Actions for Media"]');
    expect(menuTrigger).not.toBeNull();
    menuTrigger!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    menuTrigger!.click();
    expect(isExpanded()).toBe(false);

    const menuItem = await vi.waitFor(() => {
      const item = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'))
        .find((candidate) => candidate.textContent?.trim() === 'Edit group');
      expect(item).toBeDefined();
      return item!;
    });
    menuItem.click();
    expect(isExpanded()).toBe(false);
  });

  test('reveals the selected group and moves aria-current between exact source variants', async () => {
    const [pathname, setPathname] = createSignal('/widgets/published/Camera');
    const controller = {
      apiService: {
        api: {
          agent: {
            events: vi.fn(async () => [null, { async *[Symbol.asyncIterator]() {} }]),
            widgets: { catalog: vi.fn(async () => [null, catalog()]) },
          },
        },
      },
      browser: {
        setTimeout: (callback: () => void, timeout: number) => window.setTimeout(callback, timeout),
        clearTimeout: (timer: unknown) => window.clearTimeout(timer as number),
      },
      invalidation: createCatalogInvalidation(),
      application: { pathname },
    } as never;
    const container = document.createElement('div');
    host = container;
    document.body.appendChild(container);
    dispose = render(() => (
      <WidgetCatalogProvider controller={controller}>
        <WidgetsSidebarSection controller={controller} />
      </WidgetCatalogProvider>
    ), container);

    await vi.waitFor(() => expect(container.querySelectorAll('button[aria-current="page"]')).toHaveLength(1));
    const published = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent?.trim() === 'Camera');
    const draft = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent?.includes('Draft'));
    expect(published).toBeDefined();
    expect(draft).toBeDefined();
    expect(draft?.closest(`.${styles.widgetRow}`)?.classList.contains(styles.draftRow)).toBe(true);
    expect(container.querySelectorAll('button[aria-label^="Add Camera "]')).toHaveLength(0);
    expect(published?.getAttribute('aria-current')).toBe('page');
    expect(published?.classList.contains(styles.selected)).toBe(true);
    expect(draft?.hasAttribute('aria-current')).toBe(false);
    expect(draft?.classList.contains(styles.selected)).toBe(false);

    setPathname('/widgets/draft/Camera');

    await vi.waitFor(() => expect(draft?.getAttribute('aria-current')).toBe('page'));
    expect(container.querySelectorAll('button[aria-current="page"]')).toHaveLength(1);
    expect(draft?.classList.contains(styles.selected)).toBe(true);
    expect(published?.hasAttribute('aria-current')).toBe(false);
    expect(published?.classList.contains(styles.selected)).toBe(false);
  });

  test('preserves row navigation around a drag and exposes the keyboard Add action', async () => {
    const navigate = vi.fn();
    let activePlacement: { onDragStart?: () => void; onDragEnd?: () => void } | undefined;
    const beginPointerSession = vi.fn((args) => {
      activePlacement = args;
      return true;
    });
    const addToCanvas = vi.fn(async () => undefined);
    const controller = {
      apiService: {
        api: {
          agent: {
            events: vi.fn(async () => [null, { async *[Symbol.asyncIterator]() {} }]),
            widgets: { catalog: vi.fn(async () => [null, catalog()]) },
          },
        },
      },
      browser: {
        setTimeout: (callback: () => void, timeout: number) => window.setTimeout(callback, timeout),
        clearTimeout: (timer: unknown) => window.clearTimeout(timer as number),
      },
      invalidation: createCatalogInvalidation(),
      widgetPlacement: {
        available: () => true,
        beginPointerSession,
        addToCanvas,
      },
      application: {
        pathname: () => '/widgets/published/Camera',
        navigate,
        notifyError: vi.fn(),
      },
    } as never;
    const container = document.createElement('div');
    host = container;
    document.body.appendChild(container);
    dispose = render(() => (
      <WidgetCatalogProvider controller={controller}>
        <WidgetsSidebarSection controller={controller} />
      </WidgetCatalogProvider>
    ), container);

    const published = await vi.waitFor(() => {
      const button = container.querySelector<HTMLButtonElement>('button[aria-label^="Camera, published."]');
      expect(button).not.toBeNull();
      return button!;
    });
    published.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    expect(beginPointerSession).toHaveBeenCalledOnce();
    published.click();
    expect(navigate).toHaveBeenCalledOnce();

    activePlacement?.onDragStart?.();
    published.click();
    expect(navigate).toHaveBeenCalledOnce();
    activePlacement?.onDragEnd?.();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    published.click();
    expect(navigate).toHaveBeenCalledTimes(2);

    const add = container.querySelector<HTMLButtonElement>('button[aria-label="Add Camera published to canvas"]');
    expect(add?.disabled).toBe(false);
    expect(add?.textContent).toBe('Add to canvas');
    add?.click();
    await vi.waitFor(() => expect(addToCanvas).toHaveBeenCalledOnce());
    expect(addToCanvas).toHaveBeenCalledWith({
      reference: { source: 'published', name: 'Camera', revision: 'published' },
      bounds: { width: 360, height: 320 },
      label: 'Camera',
    });
  });

  test('shows Add to canvas only while a canvas placement port is active', async () => {
    let available = false;
    let availabilityListener: ((value: boolean) => void) | undefined;
    const controller = {
      apiService: {
        api: {
          agent: {
            events: vi.fn(async () => [null, { async *[Symbol.asyncIterator]() {} }]),
            widgets: { catalog: vi.fn(async () => [null, catalog()]) },
          },
        },
      },
      browser: {
        setTimeout: (callback: () => void, timeout: number) => window.setTimeout(callback, timeout),
        clearTimeout: (timer: unknown) => window.clearTimeout(timer as number),
      },
      invalidation: createCatalogInvalidation(),
      widgetPlacement: {
        available: () => available,
        subscribe(listener: (value: boolean) => void) {
          availabilityListener = listener;
          listener(available);
          return () => { availabilityListener = undefined; };
        },
        beginPointerSession: vi.fn(() => true),
        addToCanvas: vi.fn(async () => undefined),
      },
      application: {
        pathname: () => '/widgets/published/Camera',
        navigate: vi.fn(),
        notifyError: vi.fn(),
      },
    } as never;
    const container = document.createElement('div');
    host = container;
    document.body.appendChild(container);
    dispose = render(() => (
      <WidgetCatalogProvider controller={controller}>
        <WidgetsSidebarSection controller={controller} />
      </WidgetCatalogProvider>
    ), container);

    await vi.waitFor(() => expect(
      container.querySelector('button[aria-label^="Camera, published."]'),
    ).not.toBeNull());
    expect(container.querySelector('button[aria-label="Add Camera published to canvas"]')).toBeNull();

    available = true;
    availabilityListener?.(true);
    await vi.waitFor(() => expect(
      container.querySelector('button[aria-label="Add Camera published to canvas"]'),
    ).not.toBeNull());

    available = false;
    availabilityListener?.(false);
    await vi.waitFor(() => expect(
      container.querySelector('button[aria-label="Add Camera published to canvas"]'),
    ).toBeNull());
  });
});
