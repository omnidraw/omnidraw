import type {
  TWidgetPublicCatalog,
  TWidgetPublicCatalogForm,
} from '../../../src/shell/framework/feature/sidebar/ports';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { Effect } from 'effect';
import { fnWidgetToolIconTextError } from '@omnidraw/sdk/contract';
import { createCatalogInvalidation } from '../../../src/shell/framework/feature/sidebar/ports';
import { WidgetCatalogProvider } from '../../../src/shell/framework/feature/sidebar/widgets/WidgetCatalogProvider';
import { toolIconValidationError } from '../../../src/shell/framework/feature/sidebar/ToolIconPicker/ToolIconPicker';
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
  catalog?: TWidgetPublicCatalog;
  deletionPlan?: Readonly<{
    planToken: string;
    widgetKey: string;
    source: 'draft' | 'published';
    catalogDigestSha256: string;
    pairedDraftPresent: boolean;
    placementCount: number;
    previewPlacementCount: number;
    publishedPlacementCount: number;
    chatMountCount: number;
    resourcesPreserved: true;
  }>;
  planError?: Error;
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
  const planDeletion = vi.fn(async () => options.planError
    ? [options.planError, undefined]
    : [undefined, deletionPlan]);
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
  const getCatalog = vi.fn(async () => [undefined, options.catalog ?? catalog()] as const);
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
          deletion: { plan: planDeletion, commit: commitDeletion },
          publication: { publishMetadata, buildAndPublish },
        },
      },
    },
    invalidation: createCatalogInvalidation(),
    subscribeReconnect: () => () => undefined,
    lifecycle,
    browser: {
      createIdempotencyKey: () => 'operation_1',
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
    planDeletion,
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
  if (trigger.getAttribute('aria-expanded') !== 'true') {
    trigger.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
  }
  const option = await vi.waitFor(() => {
    const value = [...document.body.querySelectorAll<HTMLElement>('[role="option"]')]
      .find((candidate) => candidate.textContent?.trim() === label);
    expect(value).toBeDefined();
    return value!;
  });
  expect(option.querySelector('svg')).not.toBeNull();
  option.click();
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
    expect(button(host, 'Save draft').disabled).toBe(false);
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

  test('bounds the open collection and restores input focus after Escape', async () => {
    const { host } = mountDetail({ initialTab: 'config' });
    const input = await vi.waitFor(() => {
      const value = host.querySelector<HTMLInputElement>('[role="combobox"]');
      expect(value).not.toBeNull();
      return value!;
    });
    const trigger = host.querySelector<HTMLButtonElement>('button[aria-label="Show icon choices"]')!;
    input.focus();
    trigger.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    await vi.waitFor(() => {
      const options = document.body.querySelectorAll('[role="option"]');
      expect(options.length).toBeGreaterThan(2);
      expect(options.length).toBeLessThanOrEqual(100);
      expect([...options].every((option) => option.querySelector('svg') !== null)).toBe(true);
    });
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

  test('supports keyboard selection through the Kobalte combobox', async () => {
    const { host, saveDraft } = mountDetail({ initialTab: 'config' });
    const input = await vi.waitFor(() => {
      const value = host.querySelector<HTMLInputElement>('[role="combobox"]');
      expect(value).not.toBeNull();
      return value!;
    });
    input.focus();
    input.value = 'HeartX';
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'HeartX' }));
    input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowDown' }));
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
