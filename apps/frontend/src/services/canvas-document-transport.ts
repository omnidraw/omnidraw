import { orpcWebsocketService } from './orpc-websocket';
import { createCanvasDocumentTransport } from './canvas-document-transport-adapter';

export const canvasDocumentTransport = createCanvasDocumentTransport(
  orpcWebsocketService.apiService.api.canvas,
);
