import { render } from 'solid-js/web';
import { afterEach, describe, expect, test } from 'vitest';
import {
  WidgetIcon,
  publishedWidgetIconSafetyError,
} from '../../../src/shell/framework/feature/sidebar/widgets/components/WidgetIcon';

let dispose: (() => void) | undefined;

afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.replaceChildren();
});

function renderIcon(icon: Parameters<typeof WidgetIcon>[0]['icon']): HTMLElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  dispose = render(() => <WidgetIcon icon={icon} />, host);
  return host;
}

describe('WidgetIcon host-shell rendering', () => {
  test('retains static SVG geometry without exposing active resource surfaces', () => {
    const host = renderIcon({ svgIcon: '<svg viewBox="0 0 10 10"><path d="M1 1h8v8z" /></svg>' });
    expect(host.querySelector('svg path')?.getAttribute('d')).toBe('M1 1h8v8z');
  });

  test.each([
    '<svg><image href="//attacker.example/icon" /></svg>',
    '<svg><use href="#local-symbol" /></svg>',
    '<svg><a href="/navigate"><path d="M0 0h1" /></a></svg>',
    '<svg><style>@import"https://attacker.example/icon.css"</style></svg>',
    '<svg><path style="fill:red" d="M0 0h1" /></svg>',
    '<svg><animate attributeName="href" values="//attacker.example/icon" /></svg>',
  ])('rejects and renders no custom host-resource markup: %s', (svgIcon) => {
    expect(publishedWidgetIconSafetyError({ svgIcon })).not.toBeNull();
    const host = renderIcon({ svgIcon });
    expect(host.querySelector('image,use,a,style,animate')).toBeNull();
    expect(host.querySelector('[href],[src],[style]')).toBeNull();
    expect(host.innerHTML).not.toContain('attacker.example');
  });

  test('drops entity-obfuscated external paint references after parsing', () => {
    const host = renderIcon({
      svgIcon: '<svg><path fill="u&#x72;l(&#x2f;&#x2f;attacker.example/icon)" d="M0 0h1" /></svg>',
    });
    expect(host.innerHTML).not.toContain('attacker.example');
    expect([...host.querySelectorAll('*')].some((element) => (
      [...element.attributes].some((attribute) => attribute.value.includes('url('))
    ))).toBe(false);
  });

  test('renders a custom emoji as text rather than HTML', () => {
    const host = renderIcon({ svgIcon: '👩🏽‍💻' });
    expect(host.textContent).toBe('👩🏽‍💻');
    expect(host.querySelector('svg')).toBeNull();
  });

  test('keeps Lucide markup in a nested host and the fallback SVG direct', () => {
    const host = renderIcon({ lucidIcon: 'Camera' });
    expect(host.querySelector(':scope > span > span > svg')).not.toBeNull();

    dispose?.();
    const fallback = renderIcon(null);
    expect(fallback.querySelector(':scope > span > svg')).not.toBeNull();
  });
});
