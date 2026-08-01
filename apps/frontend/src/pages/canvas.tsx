import '@omnidraw/canvas/styles.css';
import { Canvas } from '@omnidraw/canvas';
import { useNavigate } from '@solidjs/router';
import { type Component, mapArray, onCleanup } from 'solid-js';
import { createFrontendCanvasComposition } from '../services/canvas-composition';
import { createBrowserTenantBoundary } from '../services/tenant';
import type { TBrowserTenantScope } from '../services/fn.browser-tenant-scope';
import type { TBackendCanvas } from '../types/backend.types';

type TComposedCanvasProps = Readonly<{
  canvasId: string;
  navigate(path: string): void;
  tenant: TBrowserTenantScope;
}>;

const ComposedCanvas: Component<TComposedCanvasProps> = (props) => {
  const keyedCanvas = mapArray(
    () => [props.canvasId],
    (canvasId) => {
      const composition = createFrontendCanvasComposition({
        canvasId,
        navigate: props.navigate,
        ownerDocument: document,
        tenant: props.tenant,
      });
      onCleanup(composition.dispose);
      return (
        <Canvas
          canvas={composition.canvas}
          dependencies={composition.dependencies}
          hostScopeKey={composition.hostScopeKey}
        />
      );
    },
  );
  return <>{keyedCanvas()}</>;
};

type CanvasPageProps = Readonly<{
  canvas: TBackendCanvas;
}>;

const CanvasPage: Component<CanvasPageProps> = (props) => {
  const navigate = useNavigate();
  const tenantCanvas = createBrowserTenantBoundary((tenant) => (
    <ComposedCanvas
      canvasId={props.canvas.id}
      navigate={navigate}
      tenant={tenant}
    />
  ));
  return <>{tenantCanvas()}</>;
};

export default CanvasPage;
