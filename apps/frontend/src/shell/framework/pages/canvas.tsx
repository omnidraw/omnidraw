import '@omnidraw/canvas/styles.css';
import '@omnidraw/component-ai-chat/styles.css';
import { Canvas } from '@omnidraw/canvas';
import { useNavigate } from '@solidjs/router';
import { type Component, mapArray, onCleanup } from 'solid-js';
import { createFrontendCanvasComposition } from '../../canvas/canvas-composition';
import type { TBackendCanvas } from '@/core/app/backend.types';
import { useFrontendRuntime } from '../runtime-context';

type CanvasPageProps = Readonly<{
  canvas: TBackendCanvas;
}>;

const CanvasPage: Component<CanvasPageProps> = (props) => {
  const navigate = useNavigate();
  const runtime = useFrontendRuntime();
  const keyedCanvas = mapArray(
    () => [props.canvas.id],
    (canvasId) => {
      const composition = createFrontendCanvasComposition({
        canvasId,
        navigate,
        ownerDocument: runtime.ownerDocument,
        runtime,
      });
      onCleanup(composition.dispose);
      return (
        <Canvas
          canvas={composition.canvas}
          hostScopeKey={`frontend:${canvasId}`}
          dependencies={composition.dependencies}
        />
      );
    },
  );
  return <>{keyedCanvas()}</>;
};

export default CanvasPage;
