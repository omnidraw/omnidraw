import type { TPathCommand } from "@omnidraw/cangine";
import type { TPoint2D } from "@vibecanvas/service-automerge/types/canvas-doc.types";

type TArgsCatmullRomPath = {
  points: readonly TPoint2D[];
  curved: boolean;
};

export function fnCatmullRomPath(args: TArgsCatmullRomPath): TPathCommand[] {
  const first = args.points[0] ?? [0, 0];
  const commands: TPathCommand[] = [{
    type: "M",
    to: { x: first[0], y: first[1] },
  }];
  const useCurves = args.curved && args.points.length > 2;

  for (let index = 0; index < args.points.length - 1; index += 1) {
    const p0 = args.points[index - 1] ?? args.points[index]!;
    const p1 = args.points[index]!;
    const p2 = args.points[index + 1]!;
    const p3 = args.points[index + 2] ?? p2;
    if (!useCurves) {
      commands.push({
        type: "L",
        to: { x: p2[0], y: p2[1] },
      });
      continue;
    }
    commands.push({
      type: "C",
      control1: {
        x: p1[0] + (p2[0] - p0[0]) / 6,
        y: p1[1] + (p2[1] - p0[1]) / 6,
      },
      control2: {
        x: p2[0] - (p3[0] - p1[0]) / 6,
        y: p2[1] - (p3[1] - p1[1]) / 6,
      },
      to: { x: p2[0], y: p2[1] },
    });
  }

  return commands;
}
