import { describe, expect, test } from "bun:test";
import {
  CANVAS_COLOR_CODES,
  fnIsCanvasColorCode,
  fnIsCanvasInkColorCode,
  fnThemeDefinitionIssues,
} from "./index";

const COLOR = Object.freeze({
  space: "srgb",
  r: 0,
  g: 0,
  b: 0,
  a: 1,
});

describe("theme validation", () => {
  test("keeps the product canvas vocabulary exact", () => {
    expect(CANVAS_COLOR_CODES).toEqual([
      "transparent", "neutral", "red", "yellow", "green", "blue",
    ]);
    expect(CANVAS_COLOR_CODES.every(fnIsCanvasColorCode)).toBe(true);
    expect(fnIsCanvasColorCode("primary")).toBe(false);
    expect(fnIsCanvasInkColorCode("transparent")).toBe(false);
    expect(fnIsCanvasInkColorCode("green")).toBe(true);
  });

  test("requires path dimensions to be positive", () => {
    const issues = fnThemeDefinitionIssues({
      canvas: {
        path: {
          outline: COLOR,
          anchorFill: COLOR,
          midpointFill: COLOR,
          handleStroke: COLOR,
          handleSize: 0,
          midpointSize: 0,
          rotateOffset: 0,
        },
      },
    }).filter((issue) => issue.startsWith("canvas.path."));

    expect(issues).toEqual([
      "canvas.path.handleSize must be finite and positive",
      "canvas.path.midpointSize must be finite and positive",
      "canvas.path.rotateOffset must be finite and positive",
    ]);
  });

  test("keeps zero-valued selection dimensions valid", () => {
    const issues = fnThemeDefinitionIssues({
      canvas: {
        selection: {
          outline: COLOR,
          handleFill: COLOR,
          handleStroke: COLOR,
          handleSize: 0,
          rotateHandleOffset: 0,
          outlinePadding: 0,
        },
      },
    }).filter((issue) => issue.startsWith("canvas.selection."));

    expect(issues).toEqual([]);
  });
});
