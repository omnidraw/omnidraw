import { describe, expect, test } from 'vitest';
import { fnCanvasToolShortcut } from '../../src/components/fn.canvas-tool-shortcut';

describe('fnCanvasToolShortcut', () => {
  test('leaves product-owned C unassigned in the base canvas', () => {
    expect(fnCanvasToolShortcut('c')).toBeNull();
    expect(fnCanvasToolShortcut('C')).toBeNull();
  });

  test('preserves drawing shortcuts and ignores unknown keys', () => {
    expect(fnCanvasToolShortcut('4')).toBe('text');
    expect(fnCanvasToolShortcut('R')).toBe('rect');
    expect(fnCanvasToolShortcut('?')).toBeNull();
  });
});
