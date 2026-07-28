import { describe, expect, test } from 'vitest';
import { fnCanvasToolShortcut } from '../../src/components/fn.canvas-tool-shortcut';

describe('fnCanvasToolShortcut', () => {
  test('maps C to the Cangine widget creation tool', () => {
    expect(fnCanvasToolShortcut('c')).toBe('widget');
    expect(fnCanvasToolShortcut('C')).toBe('widget');
  });

  test('preserves drawing shortcuts and ignores unknown keys', () => {
    expect(fnCanvasToolShortcut('4')).toBe('text');
    expect(fnCanvasToolShortcut('R')).toBe('rect');
    expect(fnCanvasToolShortcut('?')).toBeNull();
  });
});
