export type TFnLabelBox = {
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

export type TFnLabelObstacle = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export type TFnPlaceLabelsArgs = {
  labels: TFnLabelBox[];
  obstacles: TFnLabelObstacle[];
  space: {
    w: number;
    h: number;
  };
};

export type TFnPlacedLabel = {
  key: string;
  x: number;
  y: number;
};

const CANDIDATE_OFFSETS = [
  { x: 0, y: 0 },
  { x: 0, y: -26 },
  { x: 0, y: 26 },
  { x: 34, y: 0 },
  { x: -34, y: 0 },
  { x: 34, y: -26 },
  { x: -34, y: -26 },
  { x: 34, y: 26 },
  { x: -34, y: 26 },
  { x: 68, y: 0 },
  { x: -68, y: 0 },
  { x: 68, y: -26 },
  { x: -68, y: -26 },
  { x: 68, y: 26 },
  { x: -68, y: 26 },
  { x: 0, y: -52 },
  { x: 0, y: 52 },
  { x: 102, y: 0 },
  { x: -102, y: 0 },
  { x: 102, y: -26 },
  { x: -102, y: -26 },
  { x: 102, y: 26 },
  { x: -102, y: 26 },
  { x: 0, y: -78 },
  { x: 0, y: 78 },
  { x: 136, y: 0 },
  { x: -136, y: 0 },
] as const;

function fnRectFromCenter(label: TFnLabelBox, x: number, y: number): TFnLabelObstacle {
  return {
    x: x - label.w / 2,
    y: y - label.h / 2,
    w: label.w,
    h: label.h,
  };
}

function fnIntersects(left: TFnLabelObstacle, right: TFnLabelObstacle): boolean {
  return left.x < right.x + right.w
    && left.x + left.w > right.x
    && left.y < right.y + right.h
    && left.y + left.h > right.y;
}

function fnClamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function fnScoreCandidate(rect: TFnLabelObstacle, obstacles: TFnLabelObstacle[], placed: TFnLabelObstacle[], distance: number): number {
  const collisions = [...obstacles, ...placed].filter((obstacle) => fnIntersects(rect, obstacle)).length;

  return collisions * 10000 + distance;
}

export function fnPlaceLabels(args: TFnPlaceLabelsArgs): TFnPlacedLabel[] {
  const placedRects: TFnLabelObstacle[] = [];
  const labels = [...args.labels].sort((left, right) => (right.w * right.h) - (left.w * left.h));

  return labels.map((label) => {
    const candidates = CANDIDATE_OFFSETS.map((offset) => {
      const x = fnClamp(label.x + offset.x, label.w / 2, args.space.w - label.w / 2);
      const y = fnClamp(label.y + offset.y, label.h / 2, args.space.h - label.h / 2);
      const rect = fnRectFromCenter(label, x, y);
      const distance = Math.abs(offset.x) + Math.abs(offset.y);

      return {
        x,
        y,
        rect,
        score: fnScoreCandidate(rect, args.obstacles, placedRects, distance),
      };
    }).sort((left, right) => left.score - right.score);
    const winner = candidates[0] ?? {
      x: label.x,
      y: label.y,
      rect: fnRectFromCenter(label, label.x, label.y),
    };

    placedRects.push(winner.rect);

    return {
      key: label.key,
      x: winner.x,
      y: winner.y,
    };
  });
}
