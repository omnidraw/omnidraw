import type { TCanvasRegistrySelectionStyleConfig } from "../../services/canvas-registry/types";
import { DEFAULT_STROKE_WIDTHS } from "../../components/SelectionStyleMenu/types";
import {
  DEFAULT_OPACITY,
  DEFAULT_STROKE_COLOR_TOKEN,
  DEFAULT_STROKE_WIDTH_TOKEN,
  type TShape1dTool,
} from "./CONSTANTS";

type TArgsFnGetShape1dSelectionStyleMenuConfig = {
  type: TShape1dTool;
};

export function fnGetShape1dSelectionStyleMenuConfig(args: TArgsFnGetShape1dSelectionStyleMenuConfig): TCanvasRegistrySelectionStyleConfig {
  if (args.type === "arrow") {
    return {
      sections: {
        showStrokeColorPicker: true,
        showStrokeWidthPicker: true,
        showOpacityPicker: true,
        showLineTypePicker: true,
        showStartCapPicker: true,
        showEndCapPicker: true,
      },
      values: {
        strokeColor: DEFAULT_STROKE_COLOR_TOKEN,
        strokeWidth: DEFAULT_STROKE_WIDTH_TOKEN,
        opacity: DEFAULT_OPACITY,
        lineType: "straight",
        startCap: "none",
        endCap: "arrow",
      },
      strokeWidthOptions: [...DEFAULT_STROKE_WIDTHS],
    };
  }

  return {
    sections: {
      showStrokeColorPicker: true,
      showStrokeWidthPicker: true,
      showOpacityPicker: true,
      showLineTypePicker: true,
    },
    values: {
      strokeColor: DEFAULT_STROKE_COLOR_TOKEN,
      strokeWidth: DEFAULT_STROKE_WIDTH_TOKEN,
      opacity: DEFAULT_OPACITY,
      lineType: "straight",
    },
    strokeWidthOptions: [...DEFAULT_STROKE_WIDTHS],
  };
}
