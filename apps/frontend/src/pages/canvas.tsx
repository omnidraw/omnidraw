import '@omnidraw/canvas/styles.css';
import { Canvas } from '@omnidraw/canvas';
import { useNavigate } from '@solidjs/router';
import { type Component, mapArray, onCleanup } from 'solid-js';
import { createFrontendCanvasComposition } from '../services/canvas-composition';
import type { TBackendCanvas } from '../types/backend.types';

type CanvasPageProps = Readonly<{
  canvas: TBackendCanvas;
}>;

const CanvasPage: Component<CanvasPageProps> = (props) => {
  const navigate = useNavigate();
  const keyedCanvas = mapArray(
    () => [props.canvas.id],
    (canvasId) => {
      const composition = createFrontendCanvasComposition({
        canvasId,
        navigate,
        ownerDocument: document,
      });
      onCleanup(composition.dispose);
      return (
        <Canvas
          canvas={composition.canvas}
          dependencies={composition.dependencies}
        />
      );
    },
  );
  return <>{keyedCanvas()}</>;
};

export default CanvasPage;
