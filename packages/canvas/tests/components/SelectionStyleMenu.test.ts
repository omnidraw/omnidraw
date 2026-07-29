import { render } from 'solid-js/web';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { SelectionStyleMenu } from '../../src/components/SelectionStyleMenu';
import type {
  TSelectionStyleState,
} from '../../src/components/SelectionStyleMenu/fn.selection-style';

let dispose: (() => void) | null = null;

const state = {
  showLine: true,
  showFill: false,
  showStroke: false,
  showStrokeWidth: false,
  showOpacity: false,
  lineShape: 'curved',
  fillColor: null,
  strokeColor: null,
  strokeWidth: null,
  opacity: 1,
} satisfies TSelectionStyleState;

afterEach(() => {
  dispose?.();
  dispose = null;
  document.body.replaceChildren();
});

describe('SelectionStyleMenu line shape controls', () => {
  test('exposes the selected shape with accessible pressed state', () => {
    const host = document.createElement('div');
    document.body.append(host);
    dispose = render(() => SelectionStyleMenu({
      palette: { fillQuick: [], strokeQuick: [] } as never,
      state,
      strokeWidths: [],
      onApply: vi.fn(),
      onSetLineShape: vi.fn(),
    }), host);

    const straight = host.querySelector<HTMLButtonElement>(
      'button[aria-pressed="false"]',
    );
    const curved = [...host.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === 'Curved');
    const elbow = [...host.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === 'Elbow');

    expect(host.textContent).toContain('LINE');
    expect(straight?.textContent).toBe('Straight');
    expect(curved?.getAttribute('aria-pressed')).toBe('true');
    expect(curved?.classList.contains(
      'vc-selection-style-choice--selected',
    )).toBe(true);
    expect(elbow?.getAttribute('aria-pressed')).toBe('false');
  });

  test('activates every choice by click or keyboard', () => {
    const onSetLineShape = vi.fn();
    const host = document.createElement('div');
    document.body.append(host);
    dispose = render(() => SelectionStyleMenu({
      palette: { fillQuick: [], strokeQuick: [] } as never,
      state,
      strokeWidths: [],
      onApply: vi.fn(),
      onSetLineShape,
    }), host);

    const button = (label: string) => (
      [...host.querySelectorAll<HTMLButtonElement>('button')]
        .find((candidate) => candidate.textContent === label)
    );

    button('Straight')?.click();
    button('Curved')?.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Enter',
    }));
    button('Elbow')?.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: ' ',
    }));

    expect(onSetLineShape.mock.calls).toEqual([
      ['straight'],
      ['curved'],
      ['elbow'],
    ]);
  });
});
