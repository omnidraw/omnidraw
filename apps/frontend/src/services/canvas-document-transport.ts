import type { TCanvasDocumentTransport } from '@omnidraw/canvas';
import { orpcWebsocketService } from './orpc-websocket';

function transportError(error: unknown, fallback: string): Error {
  return error instanceof Error ? error : new Error(fallback);
}

export const canvasDocumentTransport: TCanvasDocumentTransport = Object.freeze({
  async getSnapshot(input) {
    const [error, snapshot] = await orpcWebsocketService.apiService.api.canvas.snapshot(input);
    if (error || !snapshot) throw transportError(error, 'Canvas snapshot is unavailable.');
    return snapshot;
  },
  async execute(command) {
    const [error, event] = await orpcWebsocketService.apiService.api.canvas.execute(command);
    if (error || !event) throw transportError(error, 'Canvas command was rejected.');
    return event;
  },
  async *subscribe(input) {
    const [error, events] = await orpcWebsocketService.apiService.api.canvas.events(input);
    if (error || !events) throw transportError(error, 'Canvas event stream is unavailable.');
    yield* events;
  },
});
