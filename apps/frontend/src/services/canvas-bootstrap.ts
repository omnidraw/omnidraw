import { showErrorToast } from '../components/ui/Toast';
import { runStartupCanvasBootstrap } from '../startup-canvas';
import { setStore } from '../store';
import { orpcWebsocketService } from './orpc-websocket';

type TCanvasBootstrapHost = Readonly<{
  navigate(path: string): void;
  pathname(): string;
}>;

let activeHost: TCanvasBootstrapHost | null = null;

function registerFrontendCanvasBootstrapHost(host: TCanvasBootstrapHost): () => void {
  activeHost = host;
  return () => {
    if (activeHost === host) activeHost = null;
  };
}

async function bootstrapFrontendCanvases(): Promise<void> {
  const isCurrent = () => true;
  await runStartupCanvasBootstrap({
    createCanvas: (name) => orpcWebsocketService.apiService.api.canvas.create({ name }),
    isCurrent,
    listCanvases: () => orpcWebsocketService.apiService.api.canvas.list(),
    navigate: (path) => {
      if (isCurrent()) activeHost?.navigate(path);
    },
    onError: (message) => {
      if (isCurrent()) showErrorToast(message);
    },
    setCanvases: (canvases) => {
      if (isCurrent()) setStore('canvases', canvases);
    },
  }, {
    pathname: activeHost?.pathname() ?? globalThis.location?.pathname ?? '/',
  });
}

export { bootstrapFrontendCanvases, registerFrontendCanvasBootstrapHost };
export type { TCanvasBootstrapHost };
