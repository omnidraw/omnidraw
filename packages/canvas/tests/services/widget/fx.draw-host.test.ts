import { ThemeService } from "@vibecanvas/service-theme";
import Konva from "konva";
import { describe, expect, test } from "vitest";
import { ELEMENT_DATA_ATTR } from "../../../src/core/CONSTANTS";
import {
  WIDGET_HOST_BODY_ID,
  WIDGET_HOST_HEADER_HEIGHT,
  WIDGET_HOST_MIN_BODY_HEIGHT,
  WIDGET_HOST_MIN_HEIGHT,
  WIDGET_HOST_MIN_WIDTH,
} from "../../../src/services/widget/CONSTANTS";
import { fxDrawHost, fxUpdateHost } from "../../../src/services/widget/fx.draw-host";
import type { TUiWidgetData } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import { ensureDom } from "../../test-setup";

function createPoint(x: number, y: number) {
  return { x, y, pressure: 0.5 };
}

describe("widget draw host", () => {
  test('creates fresh initial payload for each UI widget instance', () => {
    ensureDom();
    let sequence = 0;
    const widgetConfig = {
      id: 'ai',
      createInitialPayload: () => ({ sessionId: `chat-${++sequence}` }),
    };
    const portal = {
      konva: Konva,
      themeService: new ThemeService(),
      crypto: { randomUUID: () => `widget-${sequence}` } as unknown as Crypto,
    };
    const first = fxDrawHost(portal, { event: {} as never, point: createPoint(10, 20), widgetConfig });
    const second = fxDrawHost(portal, { event: {} as never, point: createPoint(30, 40), widgetConfig });
    expect((first?.getAttr(ELEMENT_DATA_ATTR) as TUiWidgetData).payload).toEqual({ sessionId: 'chat-1' });
    expect((second?.getAttr(ELEMENT_DATA_ATTR) as TUiWidgetData).payload).toEqual({ sessionId: 'chat-2' });
  });

  test("starts with an expanded body-visible minimum height", () => {
    ensureDom();

    const node = fxDrawHost({
      konva: Konva,
      themeService: new ThemeService(),
      crypto: { randomUUID: () => "widget-1" } as unknown as Crypto,
    }, {
      event: {} as never,
      point: createPoint(10, 20),
      widgetConfig: { id: "example", initialPayload: {} },
    });

    expect(node).toBeInstanceOf(Konva.Group);
    expect(node?.height()).toBe(WIDGET_HOST_MIN_HEIGHT);
    const data = node?.getAttr(ELEMENT_DATA_ATTR) as TUiWidgetData | undefined;
    expect(data).toMatchObject({
      expanded: true,
      h: WIDGET_HOST_MIN_HEIGHT,
      w: WIDGET_HOST_MIN_WIDTH,
    });

    const body = node?.findOne(`#${WIDGET_HOST_BODY_ID}`);
    expect(body).toBeInstanceOf(Konva.Rect);
    expect((body as Konva.Rect).visible()).toBe(true);
    expect((body as Konva.Rect).height()).toBe(WIDGET_HOST_MIN_BODY_HEIGHT);
  });

  test("resizes draft dimensions and still keeps body visible below minimum drag height", () => {
    ensureDom();

    const group = fxDrawHost({
      konva: Konva,
      themeService: new ThemeService(),
      crypto: { randomUUID: () => "widget-1" } as unknown as Crypto,
    }, {
      event: {} as never,
      point: createPoint(10, 20),
      widgetConfig: { id: "example", initialPayload: {} },
    });
    expect(group).toBeInstanceOf(Konva.Group);

    fxUpdateHost({
      konva: Konva,
      group: group as Konva.Group,
      themeService: new ThemeService(),
    }, {
      point: createPoint(240, WIDGET_HOST_HEADER_HEIGHT + 8),
    });

    const data = group?.getAttr(ELEMENT_DATA_ATTR) as TUiWidgetData | undefined;
    expect(group?.width()).toBe(230);
    expect(group?.height()).toBe(WIDGET_HOST_MIN_HEIGHT);
    expect(data?.w).toBe(230);
    expect(data?.h).toBe(WIDGET_HOST_MIN_HEIGHT);
    expect(data?.expanded).toBe(true);

    const body = group?.findOne(`#${WIDGET_HOST_BODY_ID}`) as Konva.Rect | undefined;
    expect(body?.visible()).toBe(true);
    expect(body?.listening()).toBe(true);
    expect(body?.height()).toBe(WIDGET_HOST_MIN_BODY_HEIGHT);
  });
});
