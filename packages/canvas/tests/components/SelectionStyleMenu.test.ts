import type {
  TSelectionStyleControl,
  TSelectionStyleState,
} from '@omnidraw/cangine/editor';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { SelectionStyleMenu } from '../../src/components/SelectionStyleMenu';

const COVERAGE = {
  selectedRootCount: 1,
  candidateTargetCount: 1,
  eligibleTargetCount: 1,
};
const BLACK = { space: 'srgb', r: 0, g: 0, b: 0, a: 1 } as const;

let dispose: (() => void) | null = null;

function state(controls: readonly TSelectionStyleControl[]): TSelectionStyleState {
  return {
    revision: 1,
    status: 'attached',
    selectedRootIds: ['selected'],
    controls,
    actions: [],
    unavailable: [],
  };
}

function handlers() {
  return {
    onApply: vi.fn(),
    onSetColor: vi.fn(),
    onBeginOpacity: vi.fn(),
    onUpdateOpacity: vi.fn(),
    onEndOpacity: vi.fn(),
  };
}

function section(host: HTMLElement, label: string) {
  return [...host.querySelectorAll<HTMLElement>('section')]
    .find((candidate) => candidate.querySelector('span')?.textContent === label);
}

afterEach(() => {
  dispose?.();
  dispose = null;
  document.body.replaceChildren();
});

describe('SelectionStyleMenu controls', () => {
  test('prefers semantic intent over equal legacy concrete swatches', () => {
    const host = document.createElement('div');
    document.body.append(host);
    dispose = render(() => SelectionStyleMenu({
      palette: {
        fillQuick: [
          { code: 'neutral', label: 'Neutral', color: '#000000', value: BLACK },
          { code: 'blue', label: 'Blue', color: '#000000', value: BLACK },
        ],
        strokeQuick: [],
      },
      semanticColors: { background: 'blue', ink: undefined },
      state: state([{
        id: 'background',
        label: 'Background',
        coverage: COVERAGE,
        value: { status: 'shared', value: BLACK },
      }]),
      strokeWidths: [],
      ...handlers(),
    }), host);

    expect(host.querySelector('[aria-label="BACKGROUND Neutral"]')
      ?.getAttribute('aria-pressed')).toBe('false');
    expect(host.querySelector('[aria-label="BACKGROUND Blue"]')
      ?.getAttribute('aria-pressed')).toBe('true');
  });

  test('renders shape names and applies reusable choice sections', () => {
    const callbacks = handlers();
    const host = document.createElement('div');
    document.body.append(host);
    dispose = render(() => SelectionStyleMenu({
      palette: {
        fillQuick: [{
          code: 'neutral', label: 'Black', color: '#000000', value: BLACK,
        }],
        strokeQuick: [{
          code: 'neutral', label: 'Black', color: '#000000', value: BLACK,
        }],
      } as never,
      state: state([
        {
          id: 'background',
          label: 'Background',
          coverage: COVERAGE,
          value: { status: 'shared', value: BLACK },
        },
        {
          id: 'foreground',
          label: 'Foreground',
          coverage: COVERAGE,
          value: { status: 'shared', value: BLACK },
        },
        {
          id: 'line-routing',
          label: 'Line',
          coverage: COVERAGE,
          value: { status: 'shared', value: 'curved' },
          options: ['straight', 'curved', 'elbow'],
        },
        {
          id: 'stroke-pattern',
          label: 'Stroke',
          coverage: COVERAGE,
          value: { status: 'shared', value: 'dashed' },
          options: ['solid', 'dashed'],
        },
      ]),
      strokeWidths: [],
      ...callbacks,
    }), host);

    expect(host.textContent).toContain('BACKGROUND');
    expect(host.textContent).toContain('BORDER COLOR');
    expect(section(host, 'LINE')?.textContent).toContain('Curved');
    expect(section(host, 'STROKE')?.textContent).toContain('Dashed');
    expect(
      section(host, 'LINE')?.querySelector('[aria-pressed="true"]')?.textContent,
    ).toBe('Curved');

    section(host, 'LINE')?.querySelectorAll('button')[0]?.click();
    section(host, 'STROKE')?.querySelectorAll('button')[0]?.click();
    host.querySelector<HTMLButtonElement>('[aria-label="BACKGROUND Black"]')
      ?.click();
    expect(callbacks.onApply.mock.calls).toEqual([
      [{ propertyId: 'line-routing', value: 'straight' }],
      [{ propertyId: 'stroke-pattern', value: 'solid' }],
    ]);
    expect(callbacks.onSetColor).toHaveBeenCalledWith(
      'background',
      { code: 'neutral', label: 'Black', color: '#000000', value: BLACK },
    );
  });

  test('uses relative text sizes and named weights', () => {
    const callbacks = handlers();
    const host = document.createElement('div');
    document.body.append(host);
    const textState = (size: number | null, revision: number) => ({
      ...state([
        {
          id: 'foreground',
          label: 'Foreground',
          coverage: COVERAGE,
          value: { status: 'shared', value: BLACK },
        },
        {
          id: 'font-family',
          label: 'Font',
          coverage: COVERAGE,
          value: { status: 'shared', value: ['Fraunces', 'serif'] },
          options: [
            ['Inter', 'sans-serif'],
            ['Fraunces', 'serif'],
            ['JetBrains Mono', 'monospace'],
          ],
        },
        {
          id: 'font-size',
          label: 'Size',
          coverage: COVERAGE,
          value: size === null
            ? { status: 'mixed' as const }
            : { status: 'shared' as const, value: size },
          options: [16, 20],
        },
        {
          id: 'font-weight',
          label: 'Weight',
          coverage: COVERAGE,
          value: { status: 'shared', value: 700 },
          options: [400, 500, 600, 700],
        },
      ]),
      revision,
    });
    const [currentState, setCurrentState] = createSignal(textState(20, 1));
    callbacks.onApply.mockImplementation((change) => {
      if (change.propertyId === 'font-size') {
        setCurrentState(textState(change.value, currentState().revision + 1));
      }
      return true;
    });
    dispose = render(() => SelectionStyleMenu({
      palette: {
        fillQuick: [],
        strokeQuick: [{ label: 'Black', color: '#000000' }],
      } as never,
      get state() {
        return currentState();
      },
      strokeWidths: [],
      ...callbacks,
    }), host);

    expect(host.textContent).toContain('COLOR');
    expect(host.textContent).not.toContain('BORDER COLOR');
    expect(section(host, 'FONT')?.textContent)
      .toContain('InterFrauncesJetBrains Mono');
    expect(section(host, 'FONT')?.querySelector('[data-property="font-family"]'))
      .not.toBeNull();
    expect(section(host, 'SIZE')?.textContent).toContain('XSSMLXL');
    expect(section(host, 'SIZE')?.querySelector('[aria-pressed="true"]')
      ?.textContent).toBe('M');
    expect(section(host, 'WEIGHT')?.textContent)
      .toContain('RegularMediumSemiboldBold');

    section(host, 'FONT')?.querySelectorAll('button')[0]?.click();
    section(host, 'SIZE')?.querySelectorAll('button')[3]?.click();
    section(host, 'WEIGHT')?.querySelectorAll('button')[0]?.click();
    expect(callbacks.onApply.mock.calls).toEqual([
      [{ propertyId: 'font-family', value: ['Inter', 'sans-serif'] }],
      [{ propertyId: 'font-size', value: 25 }],
      [{ propertyId: 'font-weight', value: 400 }],
    ]);
    expect(section(host, 'SIZE')?.querySelector('[aria-pressed="true"]')
      ?.textContent).toBe('L');

    setCurrentState(textState(30, currentState().revision + 1));
    expect(section(host, 'SIZE')?.querySelector('[aria-pressed="true"]')
      ?.textContent).toBe('M');

    setCurrentState(textState(null, currentState().revision + 1));
    expect(section(host, 'SIZE')?.querySelector('[aria-pressed="true"]'))
      .toBeNull();
    expect([...section(host, 'SIZE')?.querySelectorAll('button') ?? []]
      .every((button) => button.disabled)).toBe(true);
  });

  test('shows mixed opacity and brackets pointer or keyboard updates once', () => {
    const callbacks = handlers();
    const host = document.createElement('div');
    document.body.append(host);
    const opacityState = (selectedRootId: string) => ({
      ...state([{
        id: 'opacity',
        label: 'Opacity',
        coverage: COVERAGE,
        value: { status: 'mixed' as const },
      }]),
      selectedRootIds: [selectedRootId],
    });
    const [currentState, setCurrentState] = createSignal(opacityState('first'));
    dispose = render(() => SelectionStyleMenu({
      palette: { fillQuick: [], strokeQuick: [] } as never,
      get state() {
        return currentState();
      },
      strokeWidths: [],
      ...callbacks,
    }), host);
    const input = host.querySelector<HTMLInputElement>('input[type="range"]');

    expect(host.querySelector('output')?.textContent).toBe('Mixed');
    expect(input?.step).toBe('0.01');
    input?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    if (input) input.value = '0.4';
    input?.dispatchEvent(new InputEvent('input', { bubbles: true }));
    expect(host.querySelector('output')?.textContent).toBe('40%');
    expect(input?.style.getPropertyValue('--omnidraw-style-opacity')).toBe('40%');
    setCurrentState(opacityState('second'));
    expect(callbacks.onEndOpacity).toHaveBeenCalledTimes(1);

    input?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    if (input) input.value = '0.45';
    input?.dispatchEvent(new InputEvent('input', { bubbles: true }));
    input?.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    input?.dispatchEvent(new Event('change', { bubbles: true }));
    if (input) input.value = '0.7';
    input?.dispatchEvent(new InputEvent('input', { bubbles: true }));

    expect(callbacks.onBeginOpacity).toHaveBeenCalledTimes(2);
    expect(callbacks.onUpdateOpacity.mock.calls).toEqual([[0.4], [0.45]]);
    expect(callbacks.onEndOpacity).toHaveBeenCalledTimes(2);
    expect(callbacks.onApply).toHaveBeenLastCalledWith({
      propertyId: 'opacity',
      value: 0.7,
    });
  });

  test('isolates pointer, wheel, and keyboard events from canvas ancestors', () => {
    const callbacks = handlers();
    const host = document.createElement('div');
    const ancestorEvent = vi.fn();
    for (const type of ['pointerdown', 'wheel', 'keydown']) {
      host.addEventListener(type, ancestorEvent);
    }
    document.body.append(host);
    dispose = render(() => SelectionStyleMenu({
      palette: { fillQuick: [], strokeQuick: [] } as never,
      state: state([{
        id: 'line-routing',
        label: 'Line',
        coverage: COVERAGE,
        value: { status: 'shared', value: 'straight' },
        options: ['straight'],
      }]),
      strokeWidths: [],
      ...callbacks,
    }), host);
    const menu = host.querySelector<HTMLElement>('aside');

    menu?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    menu?.dispatchEvent(new WheelEvent('wheel', { bubbles: true }));
    menu?.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      key: 'a',
    }));
    expect(ancestorEvent).not.toHaveBeenCalled();
  });
});
