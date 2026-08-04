import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { createCatalogInvalidation } from '../../src/sidebar/ports';
import { WidgetCatalogProvider } from '../../src/sidebar/widgets/WidgetCatalogProvider';
import { WidgetsSidebarSection } from '../../src/sidebar/widgets/components/WidgetsSidebarSection';
import styles from '../../src/sidebar/widgets/components/WidgetsSidebarSection.module.css';
import { publicCatalog } from '../widget-public-catalog.fixture';

let dispose: (() => void) | undefined;
let host: HTMLDivElement | undefined;

function controller(
  pathname: () => string,
  options: Readonly<{
    catalogError?: Error;
    placement?: Record<string, unknown>;
  }> = {},
) {
  return {
    apiService: {
      api: {
        widget: {
          catalog: {
            get: vi.fn(async () => options.catalogError
              ? [options.catalogError, undefined]
              : [undefined, publicCatalog()]),
            events: vi.fn(async () => [undefined, {
              async *[Symbol.asyncIterator]() { /* no live events in this fixture */ },
            }]),
          },
        },
      },
    },
    browser: {
      setTimeout: (callback: () => void, timeout: number) => window.setTimeout(callback, timeout),
      clearTimeout: (timer: unknown) => window.clearTimeout(timer as number),
    },
    invalidation: createCatalogInvalidation(),
    widgetPlacement: options.placement,
    application: {
      pathname,
      navigate: vi.fn(),
      notifyError: vi.fn(),
    },
  } as never;
}

function mount(value: ReturnType<typeof controller>): HTMLDivElement {
  const container = document.createElement('div');
  host = container;
  document.body.appendChild(container);
  dispose = render(() => (
    <WidgetCatalogProvider controller={value}>
      <WidgetsSidebarSection controller={value} />
    </WidgetCatalogProvider>
  ), container);
  return container;
}

afterEach(() => {
  dispose?.();
  dispose = undefined;
  host?.remove();
  host = undefined;
});

describe('WidgetsSidebarSection filesystem catalog', () => {
  test('renders implicit manifest groups as keyboard-operable disclosures', async () => {
    const container = mount(controller(() => '/c/canvas-1'));
    const disclosure = await vi.waitFor(() => {
      const button = container.querySelector<HTMLButtonElement>(
        'button[aria-label="Expand media widget group"]',
      );
      expect(button).not.toBeNull();
      return button!;
    });
    const visibleRows = () => container.querySelectorAll(
      `.${styles.groupChildren} .${styles.widgetRow}`,
    ).length;

    expect(disclosure.getAttribute('aria-expanded')).toBe('false');
    expect(visibleRows()).toBe(0);
    disclosure.focus();
    disclosure.click();
    expect(document.activeElement).toBe(disclosure);
    expect(disclosure.getAttribute('aria-expanded')).toBe('true');
    expect(visibleRows()).toBe(2);
    expect(container.textContent).not.toContain('Edit group');
    expect(container.textContent).not.toContain('Delete group');
  });

  test('reveals the selected implicit group and keeps source selection exact', async () => {
    const [pathname, setPathname] = createSignal('/widgets/published/camera');
    const container = mount(controller(pathname));

    const published = await vi.waitFor(() => {
      const button = container.querySelector<HTMLButtonElement>(
        'button[aria-label="Camera, published, healthy."]',
      );
      expect(button).not.toBeNull();
      return button!;
    });
    const draft = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Camera, draft, healthy."]',
    );
    expect(draft).not.toBeNull();
    expect(published.getAttribute('aria-current')).toBe('page');
    expect(draft?.hasAttribute('aria-current')).toBe(false);

    setPathname('/widgets/draft/camera');
    await vi.waitFor(() => expect(draft?.getAttribute('aria-current')).toBe('page'));
    expect(published.hasAttribute('aria-current')).toBe(false);
    expect(container.querySelectorAll('button[aria-current="page"]')).toHaveLength(1);
  });

  test('places only the healthy published form and shows catalog failures', async () => {
    const addToCanvas = vi.fn(async () => undefined);
    const container = mount(controller(() => '/c/canvas-1', {
      placement: {
        available: () => true,
        beginPointerSession: vi.fn(() => true),
        addToCanvas,
      },
    }));
    const disclosure = await vi.waitFor(() => {
      const button = container.querySelector<HTMLButtonElement>(
        'button[aria-label="Expand media widget group"]',
      );
      expect(button).not.toBeNull();
      return button!;
    });
    disclosure.click();
    const add = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Add Camera to canvas"]',
    );
    expect(add).not.toBeNull();
    expect(container.querySelectorAll('button[aria-label="Add Camera to canvas"]'))
      .toHaveLength(1);
    add?.click();
    await vi.waitFor(() => expect(addToCanvas).toHaveBeenCalledOnce());
    expect(addToCanvas).toHaveBeenCalledWith({
      reference: { source: 'published', widgetKey: 'camera', catalogGeneration: 1 },
      bounds: { width: 480, height: 320 },
      label: 'Camera',
    });

    dispose?.();
    dispose = undefined;
    container.remove();
    const failed = mount(controller(() => '/c/canvas-1', {
      catalogError: new Error('Filesystem catalog is unavailable.'),
    }));
    await vi.waitFor(() => expect(failed.querySelector('[role="alert"]')?.textContent)
      .toContain('Filesystem catalog is unavailable.'));
  });
});
