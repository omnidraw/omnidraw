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
});
