import type {
  TWidgetPublicCatalog,
  TWidgetPublicCatalogForm,
} from '../../../src/shell/framework/feature/sidebar/ports';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { Effect } from 'effect';
import { createCatalogInvalidation } from '../../../src/shell/framework/feature/sidebar/ports';
import { WidgetCatalogProvider } from '../../../src/shell/framework/feature/sidebar/widgets/WidgetCatalogProvider';
import { WidgetDetailPage } from '../../../src/shell/framework/feature/sidebar/widgets/WidgetDetailPage';
import {
  publicCatalog,
  publicEntry,
  publicForm,
} from '../widget-public-catalog.fixture';

const cleanups: Array<() => void> = [];

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

function detailedForm(source: 'draft' | 'published'): TWidgetPublicCatalogForm {
  return {
    ...publicForm(source, { name: 'Notes Board', group: 'writing' }),
    resources: [{
      slot: 'notes',
      kind: 'db',
      effect: 'read_write',
      required: true,
    }],
    functions: [{
      schemaVersion: 1,
      exportName: 'lookupNotes',
      effect: 'fx',
      inputSchema: { type: 'object', additionalProperties: false },
      outputSchema: { type: 'array', items: { type: 'string' } },
      resources: [{ slot: 'notes', effect: 'read' }],
      limits: {
        timeoutMs: 5_000,
        memoryTier: 'small',
        outputByteLimit: 262_144,
        logByteLimit: 4_096,
      },
    }],
  };
}

function catalog(): TWidgetPublicCatalog {
  return publicCatalog([publicEntry('notes-board', {
    draft: detailedForm('draft'),
    published: detailedForm('published'),
    status: 'presentation-changed',
  })]);
}

function mountDetail(options: Readonly<{
  source?: 'draft' | 'published';
  initialTab?: string;
  saveError?: Error;
  metadataError?: Error;
}> = {}) {
  const source = options.source ?? 'draft';
  const saveDraft = vi.fn(async () => options.saveError
    ? [options.saveError, undefined]
    : [undefined, {
        widgetKey: 'notes-board',
        generation: 2,
        catalogDigestSha256: 'b'.repeat(64),
      }]);
  const publishMetadata = vi.fn(async () => options.metadataError
    ? [options.metadataError, undefined]
    : [undefined, {
        widgetKey: 'notes-board',
        generation: 2,
        catalogDigestSha256: 'b'.repeat(64),
      }]);
  const buildAndPublish = vi.fn(async () => [undefined, {
    widgetKey: 'notes-board',
    generation: 2,
    catalogDigestSha256: 'b'.repeat(64),
  }]);
  const getCatalog = vi.fn(async () => [undefined, catalog()] as const);
  const notifyError = vi.fn();
  const notifySuccess = vi.fn();
  const controller = {
    apiService: {
      api: {
        widget: {
          catalog: {
            get: getCatalog,
            events: vi.fn(async () => [undefined, {
              async *[Symbol.asyncIterator]() { /* no live events in this fixture */ },
            }]),
            files: {
              list: vi.fn(async () => [undefined, {
                entries: [{ path: 'ui/main.ts', kind: 'file', byteSize: 12 }],
                truncated: false,
              }]),
              read: vi.fn(async () => [undefined, {
                path: 'ui/main.ts',
                byteSize: 12,
                binary: false,
                truncated: false,
                text: 'export {};\n',
              }]),
            },
          },
          config: { saveDraft },
          publication: { publishMetadata, buildAndPublish },
        },
      },
    },
    invalidation: createCatalogInvalidation(),
    subscribeReconnect: () => () => undefined,
    lifecycle,
    browser: {
      setTimeout: (callback: () => void, timeout: number) => window.setTimeout(callback, timeout),
      clearTimeout: (timer: unknown) => window.clearTimeout(timer as number),
    },
    application: {
      pathname: () => `/widgets/${source}/notes-board`,
      navigate: vi.fn(),
      notifySuccess,
      notifyError,
      toggleSidebar: vi.fn(),
    },
  } as never;
  const host = document.createElement('div');
  document.body.appendChild(host);
  let selectTab: (value: string) => void = () => undefined;
  const dispose = render(() => {
    const [tab, setTab] = createSignal(options.initialTab ?? 'overview');
    selectTab = setTab;
    return <WidgetCatalogProvider controller={controller}>
      <WidgetDetailPage
        source={source}
        name="notes-board"
        controller={controller}
        query={{
          tab,
          path: () => undefined,
          set: (values: { tab?: string }) => setTab(values.tab ?? 'overview'),
        } as never}
      />
    </WidgetCatalogProvider>;
  }, host);
  cleanups.push(() => {
    dispose();
    host.remove();
  });
  return {
    host,
    selectTab,
    saveDraft,
    publishMetadata,
    buildAndPublish,
    notifyError,
    notifySuccess,
  };
}

async function tabLabels(host: HTMLElement): Promise<string[]> {
  return await vi.waitFor(() => {
    const labels = [...host.querySelectorAll<HTMLElement>('[role="tab"]')]
      .map((tab) => tab.textContent?.trim() ?? '');
    expect(labels.length).toBeGreaterThan(0);
    return labels;
  });
}

function button(host: HTMLElement, text: string): HTMLButtonElement {
  const found = [...host.querySelectorAll<HTMLButtonElement>('button')]
    .find((candidate) => candidate.textContent?.trim() === text);
  expect(found).toBeDefined();
  return found!;
}

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  document.body.replaceChildren();
});

describe('WidgetDetailPage filesystem inspector', () => {
  test('renders Config, functions, collaborative state, resources, and files without Runs or Logs', async () => {
    const { host, selectTab } = mountDetail();

    expect(await tabLabels(host)).toEqual([
      'Overview',
      'Config',
      'Functions',
      'Collaborative State',
      'Resources',
      'Files',
    ]);
    selectTab('functions');
    await vi.waitFor(() => {
      expect(host.textContent).toContain('Browser-safe function descriptors');
      expect(host.textContent).toContain('lookupNotes');
      expect(host.textContent).toContain('notes (read)');
      expect(host.textContent).not.toContain('modulePath');
    });
    selectTab('collaborative-state');
    await vi.waitFor(() => {
      expect(host.textContent).toContain('Instance-scoped collaborative state');
      expect(host.textContent).toContain('centralized versioned JSON state');
      expect(host.textContent).toContain('canvasId + elementId + widgetInstanceId');
      expect(host.textContent).toContain('Publication changes preserve that state.');
      expect(host.textContent).toContain('a'.repeat(64));
      expect(host.textContent).toContain('notes-board');
      expect(host.textContent).toContain('480 × 320');
    });
    selectTab('resources');
    await vi.waitFor(() => {
      expect(host.textContent).toContain('Portable resource requirements');
      expect(host.textContent).toContain('read_write');
    });
    expect(host.textContent).not.toContain('Runs');
    expect([...host.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent))
      .not.toContain('Logs');
  });

  test('saves strict draft Config with Ctrl/Command+S and the observed manifest digest', async () => {
    const { host, saveDraft, notifySuccess } = mountDetail({ initialTab: 'config' });
    const name = await vi.waitFor(() => {
      const input = host.querySelector<HTMLInputElement>('input[maxlength="200"]');
      expect(input?.value).toBe('Notes Board');
      return input!;
    });
    name.value = 'Renamed Notes';
    name.dispatchEvent(new InputEvent('input', { bubbles: true }));
    expect(button(host, 'Publish metadata').disabled).toBe(true);
    expect(button(host, 'Build and Publish').disabled).toBe(true);
    const event = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 's',
      ctrlKey: true,
    });
    name.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(saveDraft).toHaveBeenCalledOnce());
    expect(saveDraft).toHaveBeenCalledWith({
      widgetKey: 'notes-board',
      expectedManifestDigestSha256: 'a'.repeat(64),
      config: {
        name: 'Renamed Notes',
        description: 'Filesystem widget fixture.',
        tool: {
          label: 'Notes Board',
          icon: { lucidIcon: 'Camera' },
          group: 'writing',
          priority: 10,
        },
      },
    });
    await vi.waitFor(() => expect(notifySuccess)
      .toHaveBeenCalledWith('Widget draft Config saved'));
  });

  test('shows stale Config failures inline and keeps the explicit publication actions separate', async () => {
    const stale = new Error('Widget draft changed after this form was loaded.');
    const {
      host,
      saveDraft,
      publishMetadata,
      buildAndPublish,
      notifyError,
    } = mountDetail({ initialTab: 'config', saveError: stale });
    await vi.waitFor(() => expect(host.textContent).toContain('Widget Config'));
    button(host, 'Save draft').click();
    await vi.waitFor(() => expect(saveDraft).toHaveBeenCalledOnce());
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(stale.message);
    expect(notifyError).toHaveBeenCalledWith('Could not save widget Config', stale.message);

    button(host, 'Publish metadata').click();
    await vi.waitFor(() => expect(publishMetadata).toHaveBeenCalledOnce());
    expect(publishMetadata).toHaveBeenCalledWith({
      widgetKey: 'notes-board',
      expectedManifestDigestSha256: 'a'.repeat(64),
      expectedCatalogDigestSha256: 'a'.repeat(64),
    });
    button(host, 'Build and Publish').click();
    await vi.waitFor(() => expect(buildAndPublish).toHaveBeenCalledOnce());
  });

  test('keeps published Config read-only and hides draft publication controls', async () => {
    const { host } = mountDetail({ source: 'published', initialTab: 'config' });
    await vi.waitFor(() => expect(host.textContent).toContain('Published Config is read-only'));
    expect([...host.querySelectorAll('button')].map((value) => value.textContent?.trim()))
      .not.toContain('Save draft');
    expect(host.textContent).not.toContain('Publish metadata');
    expect(host.textContent).not.toContain('Build and Publish');
  });
});
