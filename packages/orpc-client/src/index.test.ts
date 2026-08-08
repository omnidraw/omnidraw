import { describe, expect, test } from "bun:test";
import { OrpcWebsocketService } from "./index";

class DeferredWebSocket extends EventTarget {
  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;
  readyState = this.CONNECTING;
  readonly sent: unknown[] = [];

  send(value: unknown): void {
    if (this.readyState !== this.OPEN) {
      throw new Error("Cannot send message, WebSocket is not open.");
    }
    this.sent.push(value);
  }

  close(): void {
    this.readyState = this.CLOSED;
    this.dispatchEvent(new Event("close"));
  }

  open(): void {
    this.readyState = this.OPEN;
    this.dispatchEvent(new Event("open"));
  }
}

describe("OrpcWebsocketService", () => {
  test("holds an immediate request until the WebSocket opens", async () => {
    const websocket = new DeferredWebSocket();
    const service = new OrpcWebsocketService({
      websocket: websocket as never,
    });

    const request = service.apiService.api.canvas.list();
    await Promise.resolve();
    expect(websocket.sent).toHaveLength(0);

    websocket.open();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(websocket.sent).toHaveLength(1);

    service.dispose();
    void request.catch(() => undefined);
  });

  test("rejects a readiness wait when the socket fails before opening", async () => {
    const websocket = new DeferredWebSocket();
    const service = new OrpcWebsocketService({
      websocket: websocket as never,
    });
    const ready = service.waitUntilOpen();

    websocket.dispatchEvent(new Event("error"));

    await expect(ready).rejects.toThrow(
      "The WebSocket connection failed before opening.",
    );
    service.dispose();
  });

  test("returns a safe error tuple when the socket fails before opening", async () => {
    const websocket = new DeferredWebSocket();
    const service = new OrpcWebsocketService({
      websocket: websocket as never,
    });
    const request = service.apiService.api.canvas.list();

    websocket.dispatchEvent(new Event("error"));

    const [error, result] = await request;
    expect(error?.message).toBe(
      "The WebSocket connection failed before opening.",
    );
    expect(result).toBeUndefined();
    service.dispose();
  });

  test("returns a safe error tuple when disposed before opening", async () => {
    const websocket = new DeferredWebSocket();
    const service = new OrpcWebsocketService({
      websocket: websocket as never,
    });
    const request = service.apiService.api.canvas.list();

    service.dispose();

    const [error, result] = await request;
    expect(error?.message).toBe(
      "The WebSocket connection closed before opening.",
    );
    expect(result).toBeUndefined();
  });
});
