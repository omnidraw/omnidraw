import {
  createInfiniteCanvas,
  type IInfiniteCanvasEngine,
  type IRetainedProjectionOwner,
} from '@omnidraw/cangine';

/** Concrete Cangine construction stays at the Canvas package shell. */
export function createCanvasEngine(host: HTMLDivElement): Promise<IInfiniteCanvasEngine> {
  return createInfiniteCanvas({
    host,
    renderProfile: {
      vector2D: 'webgl2',
      threeD: 'disabled',
      portals: 'dom',
      fallbackOrder: ['webgl2', 'svg'],
      antialias: true,
    },
  });
}

export function createCanvasBackgroundOwner(
  engine: IInfiniteCanvasEngine,
): IRetainedProjectionOwner {
  return engine.projections.createOwner('omnidraw:canvas-background', {
    band: 'background',
    orderKey: '1000000000000000',
    hitTest: 'none',
  });
}
