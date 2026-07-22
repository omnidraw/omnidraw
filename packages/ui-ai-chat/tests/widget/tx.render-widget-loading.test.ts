import { describe, expect, test } from 'vitest';
import { txRenderWidgetError } from '../../src/widget/tx.render-widget-error';
import { txRenderWidgetLoading } from '../../src/widget/tx.render-widget-loading';
import { ensureDom } from '../test-setup';

describe('txRenderWidgetLoading', () => {
  test('replaces a transient host error with an accessible loading state', () => {
    ensureDom();
    const root = document.createElement('div');
    txRenderWidgetError({ document }, {
      root,
      error: {
        phase: 'snapshot',
        code: 'WIDGET_RUNTIME_PENDING',
        message: 'Widget runtime is starting.',
        retryable: true,
      },
      replaceContent: false,
    });

    txRenderWidgetLoading({ document }, { root });

    expect(root.querySelector('[data-widget-host-error]')).toBeNull();
    expect(root.querySelector('[data-widget-host-loading]')?.textContent).toBe('Loading widget…');
    expect(root.querySelector('[role="status"]')).not.toBeNull();
  });

  test('does not add duplicate loading states', () => {
    ensureDom();
    const root = document.createElement('div');

    txRenderWidgetLoading({ document }, { root });
    txRenderWidgetLoading({ document }, { root });

    expect(root.querySelectorAll('[data-widget-host-loading]')).toHaveLength(1);
  });
});
