export type TFnLayoutState = {
  name: string;
};

export type TFnLayoutSpace = {
  w: number;
  h: number;
};

export type TFnLayoutBox = {
  w: number;
  h: number;
};

export type TFnLayoutStateMachineArgs = {
  states: TFnLayoutState[];
  space: TFnLayoutSpace;
  box: TFnLayoutBox;
};

export type TFnLayoutPosition = {
  name: string;
  x: number;
  y: number;
};

const LANE_X: Record<string, number> = {
  booting: 0.1,
  ready: 0.1,
  busy: 0.4,
  waiting: 0.4,
  error: 0.7,
};

const LANE_Y: Record<string, number> = {
  booting: 0.15,
  ready: 0.5,
  busy: 0.18,
  waiting: 0.66,
  error: 0.5,
};

function getBaseName(stateName: string): string {
  return stateName.split(".")[0] ?? stateName;
}

export function fnLayoutStateMachine(args: TFnLayoutStateMachineArgs): TFnLayoutPosition[] {
  const laneCounts = new Map<string, number>();
  const boxW = args.space.w > 0 ? args.box.w / args.space.w : 0;
  const boxH = args.space.h > 0 ? args.box.h / args.space.h : 0;

  return args.states.map((state) => {
    const baseName = getBaseName(state.name);
    const laneCount = laneCounts.get(baseName) ?? 0;
    const laneX = LANE_X[baseName] ?? 0.7;
    const laneY = LANE_Y[baseName] ?? 0.18;
    const staggerY = laneCount * (boxH + (baseName === "error" ? 0.13 : 0.045));
    const staggerX = laneCount > 0 && baseName === "error" ? 0 : 0;

    laneCounts.set(baseName, laneCount + 1);

    return {
      name: state.name,
      x: Math.max(0, Math.min(1 - boxW, laneX + staggerX)),
      y: Math.max(0, Math.min(1 - boxH, laneY + staggerY)),
    };
  });
}
