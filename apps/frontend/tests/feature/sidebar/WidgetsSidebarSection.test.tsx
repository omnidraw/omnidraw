import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { Effect } from 'effect';
import {
  createCatalogInvalidation,
  type TSidebarController,
} from '../../../src/shell/framework/feature/sidebar/ports';
import { WidgetCatalogProvider } from '../../../src/shell/framework/feature/sidebar/widgets/WidgetCatalogProvider';
import { WidgetsSidebarSection } from '../../../src/shell/framework/feature/sidebar/widgets/components/WidgetsSidebarSection';
import styles from '../../../src/shell/framework/feature/sidebar/widgets/components/WidgetsSidebarSection.module.css';
import { publicCatalog, publicEntry, publicForm } from '../widget-public-catalog.fixture';

let dispose: (() => void) | undefined;
let host: HTMLDivElement | undefined;

const lifecycle = {
  fork<A, E>(
    program: Effect.Effect<A, E>,
    observer: Readonly<{ onSuccess?(value: A): void; onError?(error: E): void }> = {},
  ) {
    return Effect.runCallback(program.pipe(
      Effect.tap((value) => Effect.sync(() => observer.onSuccess?.(value))),
      Effect.catch((error) => Effect.sync(() => observer.onError?.(error))),
    ));
  },
};

function controller(
  pathname: () => string,
  options: Readonly<{
    catalog?: () => ReturnType<typeof publicCatalog>;
    catalogError?: Error;
    placement?: Record<string, unknown>;
  }> = {},
): TSidebarController {
  return {
    apiService: {
      api: {
        widget: {
          catalog: {
            get: vi.fn(async () => options.catalogError
              ? [options.catalogError, undefined]
              : [undefined, options.catalog?.() ?? publicCatalog()]),
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
    subscribeReconnect: () => () => undefined,
    lifecycle,
    widgetPlacement: options.placement,
    application: {
      pathname,
      navigate: vi.fn(),
      notifyError: vi.fn(),
    },
  } as unknown as TSidebarController;
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
  test('renders the first AI-created draft after shared invalidation without remounting', async () => {
    let catalog = publicCatalog([]);
    const value = controller(() => '/c/canvas-1', {
      catalog: () => catalog,
      placement: {
        available: () => true,
        beginPointerSession: vi.fn(() => true),
        addToCanvas: vi.fn(async () => undefined),
      },
    });
    const container = mount(value);
    await vi.waitFor(() => expect(container.textContent).toContain('No widget folders found.'));

    catalog = {
      ...publicCatalog([publicEntry('click-counter', {
        draft: publicForm('draft', { name: 'Click Counter', group: null }),
        published: null,
        status: 'draft-only',
      })]),
      generation: 2,
      catalogDigestSha256: 'b'.repeat(64),
    };
    value.invalidation.invalidate('widgets');

    await vi.waitFor(() => expect(container.querySelector(
      'button[aria-label="Click Counter, draft, healthy."]',
    )).not.toBeNull());
    expect(container.textContent).toContain('Draft');
    expect(container.querySelector(
      'button[aria-label="Preview Click Counter on canvas"]',
    )).not.toBeNull();
    expect(value.apiService.api.widget.catalog.get).toHaveBeenCalledTimes(2);
  });

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

  test('places published and healthy draft forms and shows catalog failures', async () => {
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
    const preview = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Preview Camera on canvas"]',
    );
    expect(add?.textContent).toBe('Add');
    expect(preview?.textContent).toBe('Preview');
    add?.click();
    await vi.waitFor(() => expect(addToCanvas).toHaveBeenCalledOnce());
    expect(addToCanvas).toHaveBeenCalledWith({
      reference: { source: 'published', widgetKey: 'camera', catalogGeneration: 1 },
      bounds: { width: 480, height: 320 },
      label: 'Camera',
    });
    preview?.click();
    await vi.waitFor(() => expect(addToCanvas).toHaveBeenCalledTimes(2));
    expect(addToCanvas).toHaveBeenLastCalledWith({
      reference: { source: 'draft', widgetKey: 'camera', catalogGeneration: 1 },
      bounds: { width: 360, height: 320 },
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
