import { describe, expect, it } from 'vitest';
import {
  fnCanBeginSpacePan,
  fnSpacePanScreenDelta,
} from '../../src/components/fn.space-pan';

describe('Space pan direction', () => {
  it('passes the pointer delta through so camera pan polarity reverses', () => {
    expect(fnSpacePanScreenDelta({
      previous: { x: 40, y: 70 },
      current: { x: 85, y: 55 },
    })).toEqual({ x: 45, y: -15 });
  });

  it('owns Space pan across every engine-host surface', () => {
    expect(fnCanBeginSpacePan({
      insideCanvasSurface: true,
      primaryButton: true,
      spaceHeld: true,
      widgetContentFocused: false,
    })).toBe(true);
  });

  it('yields Space pan when widget content is focused', () => {
    expect(fnCanBeginSpacePan({
      insideCanvasSurface: true,
      primaryButton: true,
      spaceHeld: true,
      widgetContentFocused: true,
    })).toBe(false);
  });

  it.each([
    { insideCanvasSurface: false, primaryButton: true, spaceHeld: true },
    { insideCanvasSurface: true, primaryButton: false, spaceHeld: true },
    { insideCanvasSurface: true, primaryButton: true, spaceHeld: false },
  ])('rejects non-pan input: %o', (input) => {
    expect(fnCanBeginSpacePan({
      ...input,
      widgetContentFocused: false,
    })).toBe(false);
  });
});
