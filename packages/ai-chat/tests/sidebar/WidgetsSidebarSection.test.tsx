import type { TWidgetCatalog, TWidgetVariantSummary } from '@vibecanvas/orpc-client';
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
    kind: 'actor-widget',
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

afterEach(() => {
  dispose?.();
  dispose = undefined;
  host?.remove();
  host = undefined;
});

describe('WidgetsSidebarSection selection', () => {
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
    expect(container.querySelector<HTMLButtonElement>('button[aria-label="Add Camera draft to canvas"]')?.classList.contains(styles.draftAddButton)).toBe(true);
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
    add?.click();
    await vi.waitFor(() => expect(addToCanvas).toHaveBeenCalledOnce());
    expect(addToCanvas).toHaveBeenCalledWith({
      reference: { source: 'published', name: 'Camera', revision: 'published' },
      bounds: { width: 360, height: 320 },
      label: 'Camera',
    });
  });
});
