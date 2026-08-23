import type {
  TWidgetPublicCatalog,
  TWidgetPublicCatalogForm,
} from '../../../src/shell/framework/feature/sidebar/ports';
import { createSignal } from 'solid-js';
import * as LucideStatic from 'lucide-static';
import { render } from '@solidjs/web';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { Effect } from 'effect';
import {
  fnWidgetToolIconTextError,
  type TOmnidrawToolIcon,
} from '@omnidraw/sdk/contract';
import { createCatalogInvalidation } from '../../../src/shell/framework/feature/sidebar/ports';
import { WidgetCatalogProvider } from '../../../src/shell/framework/feature/sidebar/widgets/WidgetCatalogProvider';
import {
  CURATED_LUCIDE_ICON_IDS,
  toolIconValidationError,
} from '../../../src/shell/framework/feature/sidebar/ToolIconPicker/ToolIconPicker';
import { WidgetDetailPage } from '../../../src/shell/framework/feature/sidebar/widgets/WidgetDetailPage';
import type { TWidgetPublicDeletionPlan } from '../../../src/core/app/private-operation-contract';
import {
  publicCatalog,
  publicEntry,
  publicForm,
} from '../widget-public-catalog.fixture';
import { settleSolidUpdate } from '../../settled';

const cleanups: Array<() => void> = [];

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((onResolve) => {
    resolve = onResolve;
  });
  return { promise, resolve };
}

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

function deletionPlanFixture(args: Readonly<{
  planToken: string;
  widgetKey: string;
  source: 'draft' | 'published';
  placementCount?: number;
  previewPlacementCount?: number;
}>): TWidgetPublicDeletionPlan {
  const placementCount = args.placementCount ?? (args.source === 'published' ? 3 : 1);
  return {
    planToken: args.planToken,
    widgetKey: args.widgetKey,
    source: args.source,
    catalogDigestSha256: 'a'.repeat(64),
    pairedDraftPresent: args.source === 'published',
    placementCount,
    previewPlacementCount: args.previewPlacementCount ?? 1,
    publishedPlacementCount: args.source === 'published' ? placementCount : 0,
    chatMountCount: 2,
    resourcesPreserved: true,
  };
}

function catalogWithAlternateWidget(): TWidgetPublicCatalog {
  return publicCatalog([
    ...catalog().entries,
    publicEntry('tasks-board', {
      draft: detailedForm('draft'),
      published: detailedForm('published'),
      status: 'presentation-changed',
    }),
  ]);
}

function mountDetail(options: Readonly<{
  source?: 'draft' | 'published';
  initialTab?: string;
  saveError?: Error;
  metadataError?: Error;
  publishedIconError?: Error;
  catalog?: TWidgetPublicCatalog;
  catalogRefreshError?: Error;
  catalogRefreshErrorCount?: number;
  catalogRefreshGate?: Promise<void>;
  deletionPlan?: TWidgetPublicDeletionPlan;
  planError?: Error;
  plan?: (input: Readonly<{
    widgetKey: string;
    source: 'draft' | 'published';
  }>) => Promise<readonly [Error | undefined, TWidgetPublicDeletionPlan | undefined]>;
  commit?: () => Promise<readonly [Error | undefined, unknown]>;
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
  let savedPublishedIcon: TOmnidrawToolIcon | null | undefined;
  const updatePublishedIcon = vi.fn(async (input: Readonly<{ icon: TOmnidrawToolIcon | null }>) => {
    if (options.publishedIconError) return [options.publishedIconError, undefined] as const;
    savedPublishedIcon = input.icon;
    return [undefined, {
      widgetKey: 'notes-board',
      generation: 2,
      catalogDigestSha256: 'b'.repeat(64),
    }] as const;
  });
  const buildAndPublish = vi.fn(async () => [undefined, {
    widgetKey: 'notes-board',
    generation: 2,
    catalogDigestSha256: 'b'.repeat(64),
  }]);
  const deletionPlan = options.deletionPlan ?? {
    planToken: 'plan_1',
    widgetKey: 'notes-board',
    source,
    catalogDigestSha256: 'a'.repeat(64),
    pairedDraftPresent: source === 'published',
    placementCount: source === 'published' ? 3 : 1,
    previewPlacementCount: 1,
    publishedPlacementCount: source === 'published' ? 2 : 0,
    chatMountCount: 2,
    resourcesPreserved: true as const,
  };
  const planDeletion = vi.fn(options.plan ?? (async () => options.planError
    ? [options.planError, undefined] as const
    : [undefined, deletionPlan] as const));
  const commitDeletion = vi.fn(options.commit ?? (async () => [undefined, {
    status: 'committed',
    operationId: 'operation_1',
    widgetKey: 'notes-board',
    source,
    generation: 2,
    catalogDigestSha256: 'b'.repeat(64),
    removedPlacementCount: deletionPlan.placementCount,
    removedChatMountCount: deletionPlan.chatMountCount,
    resourcesPreserved: true,
  }]));
  const initialCatalog = options.catalog ?? catalog();
  let remainingCatalogRefreshErrors = options.catalogRefreshErrorCount ?? 0;
  const getCatalog = vi.fn(async () => {
    if (savedPublishedIcon !== undefined) {
      await options.catalogRefreshGate;
      if (options.catalogRefreshError && remainingCatalogRefreshErrors > 0) {
        remainingCatalogRefreshErrors -= 1;
        return [options.catalogRefreshError, undefined] as const;
      }
      const refreshed: TWidgetPublicCatalog = {
        ...initialCatalog,
        generation: 2,
        catalogDigestSha256: 'b'.repeat(64),
        entries: initialCatalog.entries.map((entry) => entry.widgetKey !== 'notes-board'
          ? entry
          : {
              ...entry,
              published: entry.published === null ? null : {
                ...entry.published,
                manifestDigestSha256: 'c'.repeat(64),
                config: entry.published.config === null ? null : {
                  ...entry.published.config,
                  tool: {
                    ...entry.published.config.tool,
                    icon: savedPublishedIcon ?? null,
                  },
                },
              },
            }),
      };
      return [undefined, refreshed] as const;
    }
    return [undefined, initialCatalog] as const;
  });
  const notifyError = vi.fn();
  const notifySuccess = vi.fn();
  const createIdempotencyKey = vi.fn(() => 'operation_1');
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
          deletion: { plan: planDeletion, commit: commitDeletion },
          publication: { publishMetadata, updateIcon: updatePublishedIcon, buildAndPublish },
        },
      },
    },
    invalidation: createCatalogInvalidation(),
    subscribeReconnect: () => () => undefined,
    lifecycle,
    browser: {
      createIdempotencyKey,
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
  const invalidate = vi.spyOn(controller.invalidation, 'invalidate');
  const navigate = vi.spyOn(controller.application, 'navigate');
  const host = document.createElement('div');
  document.body.appendChild(host);
  let selectTab: (value: string) => void = () => undefined;
  let setRoute: (value: Readonly<{
    source: 'draft' | 'published';
    name: string;
  }>) => void = () => undefined;
  const dispose = render(() => {
    const [tab, setTab] = createSignal(options.initialTab ?? 'overview');
    const [route, updateRoute] = createSignal({ source, name: 'notes-board' } as const);
    selectTab = setTab;
    setRoute = updateRoute;
    return <WidgetCatalogProvider controller={controller}>
      <WidgetDetailPage
        source={route().source}
        name={route().name}
        controller={controller}
        query={{
          tab,
          path: () => undefined,
          set: (values: { tab?: string }) => setTab(values.tab ?? 'overview'),
        } as never}
      />
    </WidgetCatalogProvider>;
  }, host);
  let disposed = false;
  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    dispose();
    host.remove();
  };
  cleanups.push(cleanup);
  return {
    host,
    dispose: cleanup,
    setRoute,
    selectTab,
    saveDraft,
    publishMetadata,
    updatePublishedIcon,
    buildAndPublish,
    notifyError,
    notifySuccess,
    getCatalog,
    planDeletion,
    createIdempotencyKey,
    commitDeletion,
    invalidate,
    navigate,
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

async function selectIconOption(host: HTMLElement, label: string): Promise<void> {
  const trigger = await vi.waitFor(() => {
    const value = host.querySelector<HTMLButtonElement>('button[aria-label="Show icon choices"]');
    expect(value).not.toBeNull();
    return value!;
  });
  const input = host.querySelector<HTMLInputElement>('[role="combobox"]')!;
  input.value = label;
  input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: label }));
  await settleSolidUpdate();
  if (trigger.getAttribute('aria-expanded') !== 'true') {
    trigger.click();
  }
  const option = await vi.waitFor(() => {
    const value = [...document.body.querySelectorAll<HTMLElement>('[role="option"]')]
      .find((candidate) => candidate.textContent?.trim() === label);
    expect(value).toBeDefined();
    return value!;
  });
  expect(option.querySelector('svg')).not.toBeNull();
  option.click();
  await settleSolidUpdate();
}

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  document.body.replaceChildren();
});

describe('WidgetDetailPage filesystem inspector', () => {
  test('keeps browser custom-icon validation aligned with the SDK authority', () => {
    const values = [
      '', ' ', '⭐', '👩🏽‍💻', '🇩🇪', 'ab', 'a\0',
      '<svg></svg>', '<svg><path d="M0 0h1" /></svg>', '<svg>',
      '<svg><script /></svg>', '<svg><foreignObject /></svg>',
      '<svg onfocus="alert(1)"></svg>', '<svg><use href="javascript:x" /></svg>',
      '<svg><image href="https://example.com/x" /></svg>',
      '<svg><style>.x{fill:url(x)}</style></svg>',
      `<svg>${'a'.repeat(16_384)}</svg>`,
    ];
    for (const value of values) {
      expect(toolIconValidationError({ svgIcon: value }))
        .toBe(fnWidgetToolIconTextError(value));
    }
  });

  test('renders Config, functions, resources, and files without removed state, Runs, or Logs', async () => {
    const { host, selectTab } = mountDetail();

    expect(await tabLabels(host)).toEqual([
      'Overview',
      'Config',
      'Functions',
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
    expect(host.textContent).not.toContain('Collaborative State');
    selectTab('resources');
    await vi.waitFor(() => {
      expect(host.textContent).toContain('Portable resource requirements');
      expect(host.textContent).toContain('read_write');
    });
    expect(host.textContent).not.toContain('Runs');
    expect([...host.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent))
      .not.toContain('Logs');
  });

  test('falls back to Overview for the removed collaborative-state tab URL', async () => {
    const { host } = mountDetail({ initialTab: 'collaborative-state' });
    await vi.waitFor(() => {
      expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('Overview');
    });
  });

  test('links tabs to panels and supports automatic keyboard traversal', async () => {
    const { host } = mountDetail();
    const overview = await vi.waitFor(() => {
      const tab = host.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]');
      expect(tab).not.toBeNull();
      return tab!;
    });
    overview.focus();
    overview.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowRight' }));
    const config = await vi.waitFor(() => {
      const tab = [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
        .find((candidate) => candidate.textContent === 'Config')!;
      expect(tab.getAttribute('aria-selected')).toBe('true');
      expect(document.activeElement).toBe(tab);
      return tab;
    });
    const panelId = config.getAttribute('aria-controls');
    const panel = panelId === null ? null : document.getElementById(panelId);
    expect(panel?.getAttribute('role')).toBe('tabpanel');
    expect(panel?.getAttribute('aria-labelledby')).toBe(config.id);
    config.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'End' }));
    await vi.waitFor(() => {
      expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('Files');
    });
  });

  test('saves strict draft Config from the header and leaves Ctrl/Command+S unbound', async () => {
    const { host, saveDraft, notifySuccess } = mountDetail({ initialTab: 'config' });
    const name = await vi.waitFor(() => {
      const input = host.querySelector<HTMLInputElement>('input[maxlength="200"]');
      expect(input?.value).toBe('Notes Board');
      return input!;
    });
    name.value = 'Renamed Notes';
    name.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await settleSolidUpdate();
    expect(button(host, 'Publish metadata').disabled).toBe(true);
    expect(button(host, 'Build and Publish').disabled).toBe(true);
    const event = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 's',
      ctrlKey: true,
    });
    name.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(saveDraft).not.toHaveBeenCalled();
    expect(host.textContent).not.toContain('Ctrl/⌘+S');
    expect([...host.querySelectorAll('button')].map((value) => value.textContent?.trim()))
      .not.toContain('Rebuild');
    button(host, 'Save draft').click();
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

  test('restores an authored custom icon without rewriting it', async () => {
    const draft = detailedForm('draft');
    const customIcon = '👩🏽‍💻';
    const customCatalog = publicCatalog([publicEntry('notes-board', {
      draft: {
        ...draft,
        config: {
          ...draft.config!,
          tool: { ...draft.config!.tool, icon: { svgIcon: customIcon } },
        },
      },
      published: detailedForm('published'),
      status: 'presentation-changed',
    })]);
    const { host } = mountDetail({ initialTab: 'config', catalog: customCatalog });
    await vi.waitFor(() => {
      expect(host.querySelector<HTMLInputElement>('[role="combobox"]')?.value)
        .toBe('Custom SVG or emoji');
      expect(host.querySelector<HTMLTextAreaElement>('textarea[spellcheck="false"]')?.value)
        .toBe(customIcon);
    });
    expect(button(host, 'Save draft').disabled).toBe(true);
  });

  test('uses one visual icon picker and saves Lucide and no-icon choices exactly', async () => {
    const { host, saveDraft } = mountDetail({ initialTab: 'config' });
    const input = await vi.waitFor(() => {
      const value = host.querySelector<HTMLInputElement>('[role="combobox"]');
      expect(value?.value).toBe('Camera');
      return value!;
    });
    expect(host.textContent).not.toContain('Icon type');
    expect(host.textContent).not.toContain('Icon value');
    expect(input.parentElement?.querySelector('svg')).not.toBeNull();

    await selectIconOption(host, 'Heart');
    await vi.waitFor(() => expect(input.value).toBe('Heart'));
    expect(button(host, 'Publish metadata').disabled).toBe(true);
    button(host, 'Save draft').click();
    await vi.waitFor(() => expect(saveDraft).toHaveBeenCalledOnce());
    expect(saveDraft.mock.calls[0]?.[0].config.tool.icon).toEqual({ lucidIcon: 'Heart' });

    await selectIconOption(host, 'No icon');
    await vi.waitFor(() => expect(input.value).toBe('No icon'));
    button(host, 'Save draft').click();
    await vi.waitFor(() => expect(saveDraft).toHaveBeenCalledTimes(2));
    expect(saveDraft.mock.calls[1]?.[0].config.tool.icon).toBeNull();
  });

  test('opens 200 distinct curated icons when the selected label remains in the search input', async () => {
    expect(CURATED_LUCIDE_ICON_IDS).toHaveLength(200);
    expect(new Set(CURATED_LUCIDE_ICON_IDS).size).toBe(200);
    expect(new Set(CURATED_LUCIDE_ICON_IDS.map((id) => (
      (LucideStatic as Record<string, string>)[id]
    ))).size).toBe(200);
    expect(CURATED_LUCIDE_ICON_IDS.every((lucidIcon) => (
      toolIconValidationError({ lucidIcon }) === null
    ))).toBe(true);
    const draft = detailedForm('draft');
    const noIconCatalog = publicCatalog([publicEntry('notes-board', {
      draft: {
        ...draft,
        config: {
          ...draft.config!,
          tool: { ...draft.config!.tool, icon: null },
        },
      },
      published: detailedForm('published'),
      status: 'presentation-changed',
    })]);
    const { host } = mountDetail({ initialTab: 'config', catalog: noIconCatalog });
    const input = await vi.waitFor(() => {
      const value = host.querySelector<HTMLInputElement>('[role="combobox"]');
      expect(value?.value).toBe('No icon');
      return value!;
    });
    const trigger = host.querySelector<HTMLButtonElement>('button[aria-label="Show icon choices"]')!;
    input.dispatchEvent(new InputEvent('input', { bubbles: true, data: 'No icon' }));
    input.focus();
    await settleSolidUpdate();
    if (trigger.getAttribute('aria-expanded') !== 'true') {
      trigger.click();
    }

    await vi.waitFor(() => {
      const labels = [...document.body.querySelectorAll<HTMLElement>('[role="option"]')]
        .map((option) => option.textContent?.trim());
      expect(labels).toContain('Custom SVG or emoji');
      expect(labels).toContain('Languages');
      expect(labels).toHaveLength(202);
    });
    expect(trigger.querySelector('svg')).not.toBeNull();
    expect(trigger.textContent).not.toContain('⌄');
  });

  test('bounds the open collection and restores input focus after Escape', async () => {
    const { host } = mountDetail({ initialTab: 'config' });
    const input = await vi.waitFor(() => {
      const value = host.querySelector<HTMLInputElement>('[role="combobox"]');
      expect(value).not.toBeNull();
      return value!;
    });
    const trigger = host.querySelector<HTMLButtonElement>('button[aria-label="Show icon choices"]')!;
    input.focus();
    trigger.click();
    await vi.waitFor(() => {
      const options = document.body.querySelectorAll('[role="option"]');
      expect(options).toHaveLength(202);
      expect([...options].every((option) => option.querySelector('svg') !== null)).toBe(true);
      expect([...options].at(-1)?.textContent?.trim()).toBe('Languages');
      expect(input.getAttribute('aria-activedescendant')).toBe(options[0]?.id);
    });
    input.value = '';
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
    await settleSolidUpdate();
    expect(input.value).toBe('');
    input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }));
    await vi.waitFor(() => {
      expect(trigger.getAttribute('aria-expanded')).toBe('false');
      expect(document.activeElement).toBe(input);
    });
  });

  test('repairs a both-set icon and explains an unknown Lucide key', async () => {
    const both = detailedForm('draft');
    const bothCatalog = publicCatalog([publicEntry('notes-board', {
      draft: {
        ...both,
        config: {
          ...both.config!,
          tool: {
            ...both.config!.tool,
            icon: { lucidIcon: 'Camera', svgIcon: '★' },
          },
        },
      },
      published: detailedForm('published'),
      status: 'presentation-changed',
    })]);
    const repaired = mountDetail({ initialTab: 'config', catalog: bothCatalog });
    await vi.waitFor(() => {
      expect(repaired.host.querySelector<HTMLInputElement>('[role="combobox"]')?.value)
        .toBe('Custom SVG or emoji');
      expect(repaired.host.querySelector<HTMLTextAreaElement>('textarea[spellcheck="false"]')?.value)
        .toBe('★');
    });
    button(repaired.host, 'Save draft').click();
    await vi.waitFor(() => expect(repaired.saveDraft).toHaveBeenCalledOnce());
    expect(repaired.saveDraft.mock.calls[0]?.[0].config.tool.icon).toEqual({ svgIcon: '★' });

    const unknown = detailedForm('draft');
    const unknownCatalog = publicCatalog([publicEntry('notes-board', {
      draft: {
        ...unknown,
        config: {
          ...unknown.config!,
          tool: {
            ...unknown.config!.tool,
            icon: { lucidIcon: 'MissingIcon' } as never,
          },
        },
      },
      published: detailedForm('published'),
      status: 'presentation-changed',
    })]);
    const explained = mountDetail({ initialTab: 'config', catalog: unknownCatalog });
    await vi.waitFor(() => {
      expect(explained.host.querySelector<HTMLInputElement>('[role="combobox"]')?.value)
        .toBe('MissingIcon (unknown Lucide icon)');
      expect(explained.host.querySelector('[role="alert"]')?.textContent)
        .toContain('Unknown Lucide static icon key.');
      expect(button(explained.host, 'Save draft').disabled).toBe(true);
    });
  });

  test('keeps exact custom icon text, reports invalid input, and blocks malformed saves', async () => {
    const { host, saveDraft } = mountDetail({ initialTab: 'config' });
    await selectIconOption(host, 'Custom SVG or emoji');
    const textarea = await vi.waitFor(() => {
      const value = host.querySelector<HTMLTextAreaElement>('textarea[spellcheck="false"]');
      expect(value).not.toBeNull();
      return value!;
    });
    expect(host.textContent).toContain('Custom widget icons must be one trimmed grapheme or an SVG element.');
    expect(button(host, 'Save draft').disabled).toBe(true);

    expect(textarea.hasAttribute('maxlength')).toBe(false);
    const invalid = 'two graphemes';
    textarea.value = invalid;
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await vi.waitFor(() => {
      expect(textarea.value).toBe(invalid);
      expect(host.textContent).toContain('Custom text icons must contain exactly one grapheme.');
      expect(button(host, 'Save draft').disabled).toBe(true);
    });
    textarea.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 's',
      ctrlKey: true,
    }));
    expect(saveDraft).not.toHaveBeenCalled();

    const oversized = `<svg>${'a'.repeat(16_384)}</svg>`;
    textarea.value = oversized;
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await vi.waitFor(() => {
      expect(textarea.value).toBe(oversized);
      expect(host.textContent).toContain('Custom widget icons must be at most 16 KiB.');
      expect(button(host, 'Save draft').disabled).toBe(true);
    });

    const exactSvg = '<svg viewBox="0 0 10 10"><path d="M1 1h8v8z" /></svg>';
    textarea.value = exactSvg;
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await vi.waitFor(() => expect(button(host, 'Save draft').disabled).toBe(false));
    button(host, 'Save draft').click();
    await vi.waitFor(() => expect(saveDraft).toHaveBeenCalledOnce());
    expect(saveDraft.mock.calls[0]?.[0].config.tool.icon).toEqual({ svgIcon: exactSvg });

    await selectIconOption(host, 'Camera');
    await vi.waitFor(() => expect(host.querySelector('textarea[spellcheck="false"]')).toBeNull());
    await selectIconOption(host, 'Custom SVG or emoji');
    expect(host.querySelector<HTMLTextAreaElement>('textarea[spellcheck="false"]')?.value).toBe(exactSvg);
  });

  test('supports keyboard selection through the icon combobox', async () => {
    const { host, saveDraft } = mountDetail({ initialTab: 'config' });
    const input = await vi.waitFor(() => {
      const value = host.querySelector<HTMLInputElement>('[role="combobox"]');
      expect(value).not.toBeNull();
      return value!;
    });
    input.focus();
    input.value = 'HeartX';
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'HeartX' }));
    await settleSolidUpdate();
    input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowDown' }));
    await settleSolidUpdate();
    input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
    await vi.waitFor(() => expect(input.value).toBe('HeartX'));
    button(host, 'Save draft').click();
    await vi.waitFor(() => expect(saveDraft).toHaveBeenCalledOnce());
    expect(saveDraft.mock.calls[0]?.[0].config.tool.icon).toEqual({ lucidIcon: 'HeartX' });
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
    const name = await vi.waitFor(() => {
      const value = host.querySelector<HTMLInputElement>('input[maxlength="200"]');
      expect(value).not.toBeNull();
      return value!;
    });
    name.value = 'Stale Notes';
    name.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await settleSolidUpdate();
    button(host, 'Save draft').click();
    await vi.waitFor(() => expect(saveDraft).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(host.querySelector('[role="alert"]')?.textContent)
      .toContain(stale.message));
    expect(notifyError).toHaveBeenCalledWith('Could not save widget Config', stale.message);

    name.value = 'Notes Board';
    name.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await vi.waitFor(() => expect(button(host, 'Publish metadata').disabled).toBe(false));
    button(host, 'Publish metadata').click();
    await vi.waitFor(() => expect(publishMetadata).toHaveBeenCalledOnce());
    expect(publishMetadata).toHaveBeenCalledWith({
      widgetKey: 'notes-board',
      expectedManifestDigestSha256: 'a'.repeat(64),
      expectedCatalogDigestSha256: 'a'.repeat(64),
    });
    await vi.waitFor(() => expect(button(host, 'Build and Publish').disabled).toBe(false));
    button(host, 'Build and Publish').click();
    await vi.waitFor(() => expect(buildAndPublish).toHaveBeenCalledOnce());
  });

  test('updates only the published icon behind the observed manifest and catalog fences', async () => {
    const {
      host,
      updatePublishedIcon,
      notifySuccess,
    } = mountDetail({ source: 'published', initialTab: 'config' });
    const input = await vi.waitFor(() => {
      const value = host.querySelector<HTMLInputElement>('[role="combobox"]');
      expect(value?.value).toBe('Camera');
      return value!;
    });
    expect(host.textContent).toContain('Published Config is read-only except for its icon');
    expect(host.querySelector('input[maxlength="200"]')).toBeNull();
    expect(button(host, 'Save icon').disabled).toBe(true);
    expect([...host.querySelectorAll('button')].map((value) => value.textContent?.trim()))
      .not.toContain('Save draft');
    expect(host.textContent).not.toContain('Publish metadata');
    expect(host.textContent).not.toContain('Build and Publish');

    await selectIconOption(host, 'Heart');
    await vi.waitFor(() => expect(button(host, 'Save icon').disabled).toBe(false));
    const shortcut = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 's',
      ctrlKey: true,
    });
    input.dispatchEvent(shortcut);
    expect(shortcut.defaultPrevented).toBe(false);
    expect(updatePublishedIcon).not.toHaveBeenCalled();
    expect(host.textContent).not.toContain('Ctrl/⌘+S');
    button(host, 'Save icon').click();

    await vi.waitFor(() => expect(updatePublishedIcon).toHaveBeenCalledOnce());
    expect(updatePublishedIcon).toHaveBeenCalledWith({
      widgetKey: 'notes-board',
      expectedPublishedManifestDigestSha256: 'a'.repeat(64),
      expectedCatalogDigestSha256: 'a'.repeat(64),
      icon: { lucidIcon: 'Heart' },
    });
    await vi.waitFor(() => expect(notifySuccess)
      .toHaveBeenCalledWith('Published widget icon saved'));
    await vi.waitFor(() => {
      expect(input.value).toBe('Heart');
      expect(button(host, 'Save icon').disabled).toBe(true);
      expect(host.textContent).toContain('"lucidIcon": "Heart"');
    });
  });

  test('keeps the icon mutation busy through delayed catalog reconciliation', async () => {
    let releaseRefresh!: () => void;
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    const { host, updatePublishedIcon, notifySuccess } = mountDetail({
      source: 'published',
      initialTab: 'config',
      catalogRefreshGate: refreshGate,
    });
    await selectIconOption(host, 'Heart');
    button(host, 'Save icon').click();

    await vi.waitFor(() => expect(updatePublishedIcon).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(button(host, 'Refreshing icon…').disabled).toBe(true));
    expect(updatePublishedIcon).toHaveBeenCalledOnce();
    expect(notifySuccess).not.toHaveBeenCalled();

    releaseRefresh();
    await vi.waitFor(() => expect(notifySuccess)
      .toHaveBeenCalledWith('Published widget icon saved'));
    expect(button(host, 'Save icon').disabled).toBe(true);
  });

  test('retries only catalog reconciliation after a post-commit refresh failure', async () => {
    const refreshError = new Error('Catalog transport unavailable.');
    const {
      host,
      updatePublishedIcon,
      notifyError,
      notifySuccess,
    } = mountDetail({
      source: 'published',
      initialTab: 'config',
      catalogRefreshError: refreshError,
      catalogRefreshErrorCount: 1,
    });
    await selectIconOption(host, 'Heart');
    button(host, 'Save icon').click();

    await vi.waitFor(() => expect(button(host, 'Retry refresh').disabled).toBe(false));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Retry refresh');
    expect(notifyError).toHaveBeenCalledWith(
      'Published widget icon needs refresh',
      expect.stringContaining(refreshError.message),
    );
    expect(updatePublishedIcon).toHaveBeenCalledOnce();

    button(host, 'Retry refresh').click();
    await vi.waitFor(() => expect(notifySuccess)
      .toHaveBeenCalledWith('Published widget icon saved'));
    expect(updatePublishedIcon).toHaveBeenCalledOnce();
    expect(button(host, 'Save icon').disabled).toBe(true);
  });

  test('saves custom and no-icon published choices exactly', async () => {
    const custom = mountDetail({ source: 'published', initialTab: 'config' });
    await selectIconOption(custom.host, 'Custom SVG or emoji');
    const textarea = custom.host.querySelector<HTMLTextAreaElement>('textarea[spellcheck="false"]')!;
    textarea.value = '👩🏽‍💻';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await settleSolidUpdate();
    button(custom.host, 'Save icon').click();
    await vi.waitFor(() => expect(custom.updatePublishedIcon).toHaveBeenCalledOnce());
    expect(custom.updatePublishedIcon.mock.calls[0]?.[0].icon).toEqual({ svgIcon: '👩🏽‍💻' });

    const noIcon = mountDetail({ source: 'published', initialTab: 'config' });
    await selectIconOption(noIcon.host, 'No icon');
    button(noIcon.host, 'Save icon').click();
    await vi.waitFor(() => expect(noIcon.updatePublishedIcon).toHaveBeenCalledOnce());
    expect(noIcon.updatePublishedIcon.mock.calls[0]?.[0].icon).toBeNull();
  });

  test('blocks host-resource custom SVG at the published save boundary', async () => {
    const { host, updatePublishedIcon } = mountDetail({
      source: 'published',
      initialTab: 'config',
    });
    await selectIconOption(host, 'Custom SVG or emoji');
    const textarea = host.querySelector<HTMLTextAreaElement>('textarea[spellcheck="false"]')!;
    textarea.value = '<svg><image href="//attacker.example/icon" /></svg>';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await vi.waitFor(() => {
      expect(host.textContent).toContain('cannot contain resource, navigation, animation, or style markup');
      expect(button(host, 'Save icon').disabled).toBe(true);
    });
    expect(updatePublishedIcon).not.toHaveBeenCalled();
  });

  test('keeps a failed published icon update inline and reports the stale write', async () => {
    const stale = new Error('Published widget manifest changed.');
    const {
      host,
      updatePublishedIcon,
      notifyError,
    } = mountDetail({
      source: 'published',
      initialTab: 'config',
      publishedIconError: stale,
    });
    await selectIconOption(host, 'Heart');
    button(host, 'Save icon').click();

    await vi.waitFor(() => expect(updatePublishedIcon).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(host.querySelector('[role="alert"]')?.textContent)
      .toContain(stale.message));
    expect(notifyError).toHaveBeenCalledWith(
      'Could not save published widget icon',
      stale.message,
    );
  });

  test('keeps Delete available for unhealthy draft and published forms with no Config', async () => {
    const unhealthy = publicCatalog([{
      ...publicEntry('notes-board'),
      health: 'unhealthy',
      draft: {
        ...detailedForm('draft'),
        health: 'unhealthy',
        manifestDigestSha256: null,
        config: null,
        issues: [{ code: 'MANIFEST_INVALID', message: 'Unreadable manifest.' }],
      },
      published: {
        ...detailedForm('published'),
        health: 'unhealthy',
        manifestDigestSha256: null,
        config: null,
        issues: [{ code: 'RELEASE_INVALID', message: 'Unreadable release.' }],
      },
    }]);
    const draft = mountDetail({ source: 'draft', catalog: unhealthy });
    const published = mountDetail({ source: 'published', catalog: unhealthy });
    await vi.waitFor(() => {
      expect(button(draft.host, 'Delete widget').disabled).toBe(false);
      expect(button(published.host, 'Delete widget').disabled).toBe(false);
    });
  });

  test('plans before confirmation and draft cancellation preserves focus and mutates nothing', async () => {
    const mounted = mountDetail({ source: 'draft' });
    const trigger = await vi.waitFor(() => button(mounted.host, 'Delete widget'));
    trigger.focus();
    trigger.click();
    expect(document.body.querySelector('[role="alertdialog"]')).toBeNull();
    await vi.waitFor(() => expect(mounted.planDeletion).toHaveBeenCalledWith({
      widgetKey: 'notes-board',
      source: 'draft',
    }));
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('1 Preview frame');
      expect(document.body.textContent).toContain('2 AI Chat mounts');
      expect(document.body.textContent).toContain('publication and every placed published instance remain');
      expect(document.body.textContent).toContain('Independent resources remain');
    });
    button(document.body, 'Cancel').click();
    await vi.waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(mounted.commitDeletion).not.toHaveBeenCalled();
    expect(mounted.navigate).not.toHaveBeenCalled();
    expect(mounted.invalidate).not.toHaveBeenCalled();
  });

  test.each([
    {
      routeKind: 'widget',
      route: { source: 'draft', name: 'tasks-board' } as const,
      currentPlan: deletionPlanFixture({
        planToken: 'plan_tasks',
        widgetKey: 'tasks-board',
        source: 'draft',
        previewPlacementCount: 7,
      }),
      consequence: '7 Preview frames',
    },
    {
      routeKind: 'source',
      route: { source: 'published', name: 'notes-board' } as const,
      currentPlan: deletionPlanFixture({
        planToken: 'plan_published',
        widgetKey: 'notes-board',
        source: 'published',
        placementCount: 8,
      }),
      consequence: '8 Canvas placements',
    },
  ])('fences a deferred plan across a $routeKind route change', async ({
    route,
    currentPlan,
    consequence,
  }) => {
    const stalePlan = deletionPlanFixture({
      planToken: 'plan_stale',
      widgetKey: 'notes-board',
      source: 'draft',
    });
    const staleResult = deferred<readonly [undefined, TWidgetPublicDeletionPlan]>();
    const mounted = mountDetail({
      catalog: catalogWithAlternateWidget(),
      plan: async (identity) => identity.widgetKey === 'notes-board' && identity.source === 'draft'
        ? staleResult.promise
        : [undefined, currentPlan] as const,
    });

    (await vi.waitFor(() => button(mounted.host, 'Delete widget'))).click();
    await vi.waitFor(() => expect(mounted.planDeletion).toHaveBeenCalledWith({
      widgetKey: 'notes-board',
      source: 'draft',
    }));

    mounted.setRoute(route);
    await settleSolidUpdate();
    const currentTrigger = await vi.waitFor(() => button(mounted.host, 'Delete widget'));
    expect(currentTrigger.disabled).toBe(false);
    currentTrigger.click();
    await vi.waitFor(() => expect(document.querySelector('[role="alertdialog"]')?.textContent)
      .toContain(consequence));

    staleResult.resolve([undefined, stalePlan]);
    await settleSolidUpdate();
    expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain(consequence);
    button(document.body, 'Delete permanently').click();
    await vi.waitFor(() => expect(mounted.commitDeletion).toHaveBeenCalledOnce());
    expect(mounted.commitDeletion).toHaveBeenCalledWith({
      planToken: currentPlan.planToken,
      operationId: 'operation_1',
    });
  });

  test('keeps the newest review after reopening the original route', async () => {
    const stalePlan = deletionPlanFixture({
      planToken: 'plan_first',
      widgetKey: 'notes-board',
      source: 'draft',
      previewPlacementCount: 1,
    });
    const latestPlan = deletionPlanFixture({
      planToken: 'plan_latest',
      widgetKey: 'notes-board',
      source: 'draft',
      previewPlacementCount: 9,
    });
    const staleResult = deferred<readonly [undefined, TWidgetPublicDeletionPlan]>();
    let planAttempt = 0;
    const mounted = mountDetail({
      plan: async () => ++planAttempt === 1
        ? staleResult.promise
        : [undefined, latestPlan] as const,
    });

    (await vi.waitFor(() => button(mounted.host, 'Delete widget'))).click();
    await vi.waitFor(() => expect(mounted.planDeletion).toHaveBeenCalledOnce());
    mounted.setRoute({ source: 'published', name: 'notes-board' });
    await settleSolidUpdate();
    mounted.setRoute({ source: 'draft', name: 'notes-board' });
    await settleSolidUpdate();

    const reopenedTrigger = await vi.waitFor(() => button(mounted.host, 'Delete widget'));
    expect(reopenedTrigger.disabled).toBe(false);
    reopenedTrigger.click();
    await vi.waitFor(() => expect(document.querySelector('[role="alertdialog"]')?.textContent)
      .toContain('9 Preview frames'));

    staleResult.resolve([undefined, stalePlan]);
    await settleSolidUpdate();
    expect(document.querySelector('[role="alertdialog"]')?.textContent)
      .toContain('9 Preview frames');
    button(document.body, 'Delete permanently').click();
    await vi.waitFor(() => expect(mounted.commitDeletion).toHaveBeenCalledOnce());
    expect(mounted.commitDeletion).toHaveBeenCalledWith({
      planToken: 'plan_latest',
      operationId: 'operation_1',
    });
  });

  test('ignores a deferred plan after disposal', async () => {
    const planResult = deferred<readonly [undefined, TWidgetPublicDeletionPlan]>();
    const mounted = mountDetail({ plan: async () => planResult.promise });
    (await vi.waitFor(() => button(mounted.host, 'Delete widget'))).click();
    await vi.waitFor(() => expect(mounted.planDeletion).toHaveBeenCalledOnce());

    mounted.dispose();
    planResult.resolve([undefined, deletionPlanFixture({
      planToken: 'plan_after_disposal',
      widgetKey: 'notes-board',
      source: 'draft',
    })]);
    await settleSolidUpdate();

    expect(mounted.createIdempotencyKey).not.toHaveBeenCalled();
    expect(mounted.commitDeletion).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  });

  test('ignores a deferred commit completion after navigating from widget A to widget B', async () => {
    const commitResult = deferred<readonly [undefined, { status: 'committed' }]>();
    const mounted = mountDetail({
      catalog: catalogWithAlternateWidget(),
      commit: async () => commitResult.promise,
    });

    (await vi.waitFor(() => button(mounted.host, 'Delete widget'))).click();
    await vi.waitFor(() => expect(document.body.textContent).toContain('Delete permanently'));
    button(document.body, 'Delete permanently').click();
    await vi.waitFor(() => expect(mounted.commitDeletion).toHaveBeenCalledOnce());
    expect(mounted.commitDeletion).toHaveBeenCalledWith({
      planToken: 'plan_1',
      operationId: 'operation_1',
    });

    mounted.setRoute({ source: 'draft', name: 'tasks-board' });
    await settleSolidUpdate();
    const currentTrigger = await vi.waitFor(() => button(mounted.host, 'Delete widget'));
    expect(currentTrigger.disabled).toBe(false);
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();

    commitResult.resolve([undefined, { status: 'committed' }]);
    await settleSolidUpdate();
    expect(currentTrigger.disabled).toBe(false);
    expect(mounted.notifySuccess).not.toHaveBeenCalled();
    expect(mounted.notifyError).not.toHaveBeenCalled();
    expect(mounted.invalidate).not.toHaveBeenCalled();
    expect(mounted.navigate).not.toHaveBeenCalled();
  });

  test('ignores every deferred commit error continuation after disposal', async () => {
    const warnings = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const commitResult = deferred<readonly [Error, undefined]>();
    const mounted = mountDetail({ commit: async () => commitResult.promise });

    (await vi.waitFor(() => button(mounted.host, 'Delete widget'))).click();
    await vi.waitFor(() => expect(document.body.textContent).toContain('Delete permanently'));
    button(document.body, 'Delete permanently').click();
    await vi.waitFor(() => expect(mounted.commitDeletion).toHaveBeenCalledOnce());
    expect(mounted.commitDeletion).toHaveBeenCalledWith({
      planToken: 'plan_1',
      operationId: 'operation_1',
    });

    mounted.dispose();
    commitResult.resolve([new Error('Late deletion failure.'), undefined]);
    await settleSolidUpdate();

    expect(mounted.notifySuccess).not.toHaveBeenCalled();
    expect(mounted.notifyError).not.toHaveBeenCalled();
    expect(mounted.invalidate).not.toHaveBeenCalled();
    expect(mounted.navigate).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    const diagnostics = [...warnings.mock.calls, ...errors.mock.calls].flat().map(String).join('\n');
    expect(diagnostics).not.toContain('STRICT_READ_UNTRACKED');
    warnings.mockRestore();
    errors.mockRestore();
  });

  test('published confirmation reports its exact blast radius and successful commit navigates once', async () => {
    const mounted = mountDetail({ source: 'published' });
    const trigger = await vi.waitFor(() => button(mounted.host, 'Delete widget'));
    trigger.click();
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('its same-key draft and derived Preview/build state');
      expect(document.body.textContent).toContain('3 Canvas placements');
      expect(document.body.textContent).toContain('2 AI Chat mounts');
    });
    const confirm = button(document.body, 'Delete permanently');
    confirm.click();
    confirm.click();
    await vi.waitFor(() => expect(mounted.commitDeletion).toHaveBeenCalledOnce());
    expect(mounted.commitDeletion).toHaveBeenCalledWith({
      planToken: 'plan_1',
      operationId: 'operation_1',
    });
    expect(mounted.invalidate).toHaveBeenCalledOnce();
    expect(mounted.invalidate).toHaveBeenCalledWith('widgets');
    expect(mounted.navigate).toHaveBeenCalledOnce();
    expect(mounted.navigate).toHaveBeenCalledWith('/', { replace: true });
    expect(mounted.notifySuccess).toHaveBeenCalledWith('Widget publication deleted');
  });

  test('retains a failed commit for an idempotent retry', async () => {
    const temporary = Object.assign(new Error('Canvas cleanup is pending.'), {
      code: 'WIDGET_DELETION_RECOVERY_PENDING',
    });
    let commitAttempt = 0;
    const mounted = mountDetail({
      commit: async () => ++commitAttempt === 1
        ? [temporary, undefined] as const
        : [undefined, { status: 'committed' }] as const,
    });
    (await vi.waitFor(() => button(mounted.host, 'Delete widget'))).click();
    await vi.waitFor(() => expect(document.body.textContent).toContain('Delete permanently'));
    button(document.body, 'Delete permanently').click();
    await vi.waitFor(() => expect(document.body.textContent).toContain(temporary.message));
    expect(document.body.querySelector('[role="alertdialog"]')).not.toBeNull();
    button(document.body, 'Delete permanently').click();
    await vi.waitFor(() => expect(mounted.commitDeletion).toHaveBeenCalledTimes(2));
    expect(mounted.commitDeletion.mock.calls[0]?.[0]).toEqual(
      mounted.commitDeletion.mock.calls[1]?.[0],
    );
  });

  test('discards a stale plan and asks the human to review again', async () => {
    const staleError = Object.assign(new Error('Source changed.'), {
      code: 'WIDGET_DELETION_STALE_PLAN',
    });
    const stale = mountDetail({ commit: async () => [staleError, undefined] as const });
    (await vi.waitFor(() => button(stale.host, 'Delete widget'))).click();
    await vi.waitFor(() => expect(document.body.textContent).toContain('Delete permanently'));
    button(document.body, 'Delete permanently').click();
    await vi.waitFor(() => expect(stale.notifyError).toHaveBeenCalled());
    expect(stale.notifyError.mock.calls).toEqual([[
      'Could not delete widget',
      'The widget changed after you reviewed deletion. Review the current consequences and confirm again.',
    ]]);
    await vi.waitFor(() => {
      expect(stale.host.textContent).toContain('Review the current consequences and confirm again.');
      expect(stale.navigate).not.toHaveBeenCalled();
      expect(stale.invalidate).not.toHaveBeenCalled();
    });
  });
});
