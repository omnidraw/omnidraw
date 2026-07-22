import type {
  TWidgetCatalog,
  TWidgetDetail,
  TWidgetVariantSummary,
} from '@vibecanvas/orpc-client';
import type { TWidgetBrowserFunctionDescriptor } from '@vibecanvas/widget-contract';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { createCatalogInvalidation } from '../../src/sidebar/ports';
import { WidgetCatalogProvider } from '../../src/sidebar/widgets/WidgetCatalogProvider';
import { WidgetDetailPage } from '../../src/sidebar/widgets/WidgetDetailPage';

const cleanups: Array<() => void> = [];

const functionDescriptor = Object.freeze({
  schemaVersion: 1,
  exportName: 'lookupNotes',
  effect: 'fx',
  inputSchema: Object.freeze({ type: 'object', additionalProperties: false }),
  outputSchema: Object.freeze({ type: 'array', items: Object.freeze({ type: 'string' }) }),
  resources: Object.freeze([{ slot: 'notes', effect: 'read' }]),
  limits: Object.freeze({
    timeoutMs: 5_000,
    memoryTier: 'small',
    outputByteLimit: 262_144,
    logByteLimit: 4_096,
  }),
  retry: Object.freeze({
    mode: 'idempotent',
    maxAttempts: 3,
    initialBackoffMs: 100,
    maxBackoffMs: 1_000,
  }),
}) satisfies TWidgetBrowserFunctionDescriptor;

function variant(kind: TWidgetVariantSummary['kind']): TWidgetVariantSummary {
  return {
    draftId: null,
    source: 'published',
    displayName: 'Notes Board',
    kind,
    slug: 'notes-board',
    description: 'Inspector fixture.',
    revision: 'revision-7',
    contentFingerprint: 'a'.repeat(64),
    updatedAt: '2026-07-22T00:00:00.000Z',
    tool: {
      label: 'Notes Board',
      icon: null,
      group: null,
      priority: null,
      behaviorType: 'mode',
    },
    validation: null,
    placement: kind === 'widget' ? {
      reference: { source: 'published', name: 'published:definition-7', revision: 'revision-7' },
      bounds: { width: 420, height: 320 },
    } : null,
  };
}

const widgetDetail: TWidgetDetail = {
  name: 'Notes Board',
  source: 'published',
  relation: 'published-only',
  variant: variant('widget'),
  sibling: null,
  manifest: {
    schemaVersion: 2,
    name: 'Notes Board',
    slug: 'notes-board',
    description: 'Inspector fixture.',
    ui: { entry: 'ui/main.ts' },
    server: { entry: 'server/main.ts', runtimeAbi: 'vibecanvas:1' },
    resources: [{
      slot: 'notes',
      kind: 'db',
      effect: 'read_write',
      required: true,
      operations: {
        listNotes: { effect: 'read', sql: 'SELECT title FROM notes', result: 'rows' },
      },
    }],
  },
  functions: [functionDescriptor],
  problem: null,
};

function mountDetail(detail: TWidgetDetail, initialTab = 'overview') {
  const catalog: TWidgetCatalog = {
    generation: 'inspector-test',
    groups: [],
    widgets: [{
      name: detail.name,
      relation: detail.relation,
      published: detail.variant,
      draft: null,
      problem: null,
    }],
  };
  const controller = {
    apiService: {
      api: {
        agent: {
          events: vi.fn(async () => [undefined, { async *[Symbol.asyncIterator]() {} }]),
          widgets: {
            catalog: vi.fn(async () => [undefined, catalog] as const),
            detail: vi.fn(async () => [undefined, detail] as const),
            files: vi.fn(async () => [undefined, []] as const),
            file: vi.fn(async () => [undefined, null] as const),
          },
        },
      },
    },
    invalidation: createCatalogInvalidation(),
    browser: {
      setTimeout: (callback: () => void, timeout: number) => window.setTimeout(callback, timeout),
      clearTimeout: (timer: unknown) => window.clearTimeout(timer as number),
    },
    application: {
      pathname: () => `/widgets/published/${encodeURIComponent(detail.name)}`,
      navigate: vi.fn(),
      notifySuccess: vi.fn(),
      notifyError: vi.fn(),
      toggleSidebar: vi.fn(),
    },
  } as never;
  const host = document.createElement('div');
  document.body.appendChild(host);
  let selectTab: (value: string) => void = () => undefined;
  const dispose = render(() => {
    const [tab, setTab] = createSignal(initialTab);
    selectTab = setTab;
    return <WidgetCatalogProvider controller={controller}>
      <WidgetDetailPage
        source="published"
        name={detail.name}
        controller={controller}
        query={{
          tab,
          path: () => undefined,
          set: (values: { tab?: string }) => setTab(values.tab ?? 'overview'),
        } as never}
      />
    </WidgetCatalogProvider>;
  }, host);
  cleanups.push(dispose);
  return { host, selectTab };
}

async function tabLabels(host: HTMLElement): Promise<string[]> {
  return await vi.waitFor(() => {
    const labels = [...host.querySelectorAll<HTMLElement>('[role="tab"]')]
      .map((tab) => tab.textContent?.trim() ?? '');
    expect(labels.length).toBeGreaterThan(0);
    return labels;
  });
}

afterEach(() => {
  for (const dispose of cleanups.splice(0)) dispose();
  document.body.replaceChildren();
});

describe('WidgetDetailPage inspector tabs', () => {
  test('renders the published widget inspector tabs', async () => {
    const { host } = mountDetail(widgetDetail);

    expect(await tabLabels(host)).toEqual([
      'Overview',
      'Config',
      'Functions',
      'Collaborative State',
      'Runs',
      'Logs',
      'Resources',
      'Files',
    ]);
  });

  test('renders meaningful revision, invocation, and resource data', async () => {
    const { host, selectTab } = mountDetail(widgetDetail, 'functions');

    await vi.waitFor(() => {
      expect(host.textContent).toContain('server/main.ts');
      expect(host.textContent).toContain('vibecanvas:1');
      expect(host.textContent).toContain('lookupNotes');
      expect(host.textContent).toContain('notes (read)');
    });

    selectTab('collaborative-state');
    await vi.waitFor(() => {
      expect(host.textContent).toContain('Instance-scoped collaborative state');
      expect(host.textContent).toContain('Automerge state document');
      expect(host.textContent).toContain('revision-7');
      expect(host.textContent).toContain('420 × 320');
    });

    selectTab('runs');
    await vi.waitFor(() => {
      expect(host.textContent).toContain('Invocation-scoped runs');
      expect(host.textContent).toContain('do not aggregate mutable runtime state');
      expect(host.textContent).toContain('invocation ID');
    });

    selectTab('logs');
    await vi.waitFor(() => {
      expect(host.textContent).toContain('Invocation logs');
      expect(host.textContent).toContain('4096 bytes maximum');
      expect(host.textContent).toContain('No invocation is selected');
    });

    selectTab('resources');
    await vi.waitFor(() => {
      expect(host.textContent).toContain('Manifest resource requirements');
      expect(host.textContent).toContain('notes');
      expect(host.textContent).toContain('read + write');
      expect(host.textContent).toContain('listNotes');
      expect(host.textContent).toContain('host-owned');
    });
  });
});
