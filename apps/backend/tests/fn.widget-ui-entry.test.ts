import { describe, expect, test } from 'bun:test';
import { fnBootstrapWidgetUiEntry } from '../src/shell/widget/fn.widget-ui-entry';

describe('fnBootstrapWidgetUiEntry', () => {
  test('installs the Capsule guest bridge before ordinary widget source', () => {
    expect(fnBootstrapWidgetUiEntry(
      'document.body.textContent = "ready";\n',
      '../__omnidraw_guest_bridge__.mjs',
    )).toBe([
      'import "../__omnidraw_guest_bridge__.mjs";',
      'document.body.textContent = "ready";',
      '',
    ].join('\n'));
  });

  test('preserves a byte-order mark and shebang and avoids duplicate bootstraps', () => {
    const bootstrapped = [
      '\uFEFF#!/usr/bin/env node',
      'import "../__omnidraw_guest_bridge__.mjs";',
      'document.body.textContent = "ready";',
      '',
    ].join('\n');
    expect(fnBootstrapWidgetUiEntry(
      '\uFEFF#!/usr/bin/env node\ndocument.body.textContent = "ready";\n',
      '../__omnidraw_guest_bridge__.mjs',
    )).toBe(bootstrapped);
    expect(fnBootstrapWidgetUiEntry(
      'import "../__omnidraw_guest_bridge__.mjs";\ndocument.body.textContent = "ready";\n',
      '../__omnidraw_guest_bridge__.mjs',
    )).toBe(
      'import "../__omnidraw_guest_bridge__.mjs";\ndocument.body.textContent = "ready";\n',
    );
  });
});
