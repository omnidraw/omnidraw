export type TFnLayoutState = {
  name: string;
};

export type TFnLayoutTransition = {
  source: string;
  target: string;
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
  transitions?: TFnLayoutTransition[];
  space: TFnLayoutSpace;
  box: TFnLayoutBox;
  clearance?: number;
  iterations?: number;
};

export type TFnLayoutPosition = {
  name: string;
  x: number;
  y: number;
};

type TBody = {
  name: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  anchorX: number;
  anchorY: number;
};

const DEFAULT_CLEARANCE = 76;
const DEFAULT_ITERATIONS = 360;
const ANCHOR_FORCE = 0.026;
const SPRING_FORCE = 0.009;
const REPULSION_FORCE = 0.48;
const EDGE_REPULSION_FORCE = 1200;
const DAMPING = 0.72;
const MAX_STEP = 18;

function fnClamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function fnBaseName(stateName: string): string {
  return stateName.split(".")[0] ?? stateName;
}

function fnSafeRange(max: number, size: number, margin: number): { min: number; max: number } {
  const min = Math.min(margin, Math.max(0, max - size));
  const safeMax = Math.max(min, max - size - margin);

  return { min, max: safeMax };
}

function fnSeedAnchor(stateName: string, index: number, count: number, args: TFnLayoutStateMachineArgs): { x: number; y: number } {
  const baseName = fnBaseName(stateName);
  const xRange = fnSafeRange(args.space.w, args.box.w, Math.max(24, args.space.w * 0.06));
  const yRange = fnSafeRange(args.space.h, args.box.h, Math.max(24, args.space.h * 0.07));
  const centerX = (xRange.min + xRange.max) / 2;
  const centerY = (yRange.min + yRange.max) / 2;
  const thirdX = (xRange.max - xRange.min) / 3;
  const thirdY = (yRange.max - yRange.min) / 3;
  const ordinalOffset = count > 1 ? (index / Math.max(1, count - 1) - 0.5) : 0;

  if (baseName === "booting") {
    return { x: xRange.min, y: yRange.min };
  }

  if (baseName === "ready") {
    return { x: xRange.min, y: yRange.max };
  }

  if (baseName === "busy") {
    return { x: centerX, y: yRange.min + thirdY * 0.35 };
  }

  if (baseName === "waiting") {
    return { x: centerX, y: yRange.max - thirdY * 0.2 };
  }

  if (baseName === "error") {
    return { x: xRange.max, y: centerY + ordinalOffset * (args.box.h + (args.clearance ?? DEFAULT_CLEARANCE)) };
  }

  return {
    x: xRange.min + thirdX * (1 + (index % 3)),
    y: yRange.min + thirdY * (1 + Math.floor(index / 3)),
  };
}

function fnCreateBodies(args: TFnLayoutStateMachineArgs): TBody[] {
  const countByBaseName = new Map<string, number>();
  const seenByBaseName = new Map<string, number>();

  for (const state of args.states) {
    const baseName = fnBaseName(state.name);
    countByBaseName.set(baseName, (countByBaseName.get(baseName) ?? 0) + 1);
  }

  return args.states.map((state) => {
    const baseName = fnBaseName(state.name);
    const index = seenByBaseName.get(baseName) ?? 0;
    const count = countByBaseName.get(baseName) ?? 1;
    const anchor = fnSeedAnchor(state.name, index, count, args);

    seenByBaseName.set(baseName, index + 1);

    return {
      name: state.name,
      x: anchor.x,
      y: anchor.y,
      vx: 0,
      vy: 0,
      anchorX: anchor.x,
      anchorY: anchor.y,
    };
  });
}

function fnApplyAnchorForce(body: TBody): void {
  body.vx += (body.anchorX - body.x) * ANCHOR_FORCE;
  body.vy += (body.anchorY - body.y) * ANCHOR_FORCE;
}

function fnApplyBoundaryForce(body: TBody, args: TFnLayoutStateMachineArgs): void {
  const margin = Math.max(18, Math.min(args.space.w, args.space.h) * 0.04);
  const xRange = fnSafeRange(args.space.w, args.box.w, margin);
  const yRange = fnSafeRange(args.space.h, args.box.h, margin);

  if (body.x < xRange.min) {
    body.vx += (xRange.min - body.x) * 0.18;
  }

  if (body.x > xRange.max) {
    body.vx -= (body.x - xRange.max) * 0.18;
  }

  if (body.y < yRange.min) {
    body.vy += (yRange.min - body.y) * 0.18;
  }

  if (body.y > yRange.max) {
    body.vy -= (body.y - yRange.max) * 0.18;
  }
}

function fnApplyPairRepulsion(left: TBody, right: TBody, args: TFnLayoutStateMachineArgs): void {
  const clearance = args.clearance ?? DEFAULT_CLEARANCE;
  const leftCenterX = left.x + args.box.w / 2;
  const leftCenterY = left.y + args.box.h / 2;
  const rightCenterX = right.x + args.box.w / 2;
  const rightCenterY = right.y + args.box.h / 2;
  const dx = rightCenterX - leftCenterX || 1;
  const dy = rightCenterY - leftCenterY || 1;
  const distanceSq = Math.max(dx * dx + dy * dy, 1);
  const distance = Math.sqrt(distanceSq);
  const minX = args.box.w + clearance;
  const minY = args.box.h + clearance;
  const overlapX = minX - Math.abs(dx);
  const overlapY = minY - Math.abs(dy);
  const baseForce = EDGE_REPULSION_FORCE / distanceSq;

  left.vx -= (dx / distance) * baseForce;
  left.vy -= (dy / distance) * baseForce;
  right.vx += (dx / distance) * baseForce;
  right.vy += (dy / distance) * baseForce;

  if (overlapX <= 0 || overlapY <= 0) {
    return;
  }

  if (overlapX < overlapY) {
    const push = (overlapX + clearance * 0.15) * REPULSION_FORCE * (dx < 0 ? -1 : 1);
    left.vx -= push;
    right.vx += push;

    return;
  }

  const push = (overlapY + clearance * 0.15) * REPULSION_FORCE * (dy < 0 ? -1 : 1);
  left.vy -= push;
  right.vy += push;
}

function fnApplyTransitionSpring(source: TBody, target: TBody, args: TFnLayoutStateMachineArgs): void {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const distance = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
  const desiredDistance = Math.max(args.box.w * 1.45, args.box.h * 2.2);
  const force = (distance - desiredDistance) * SPRING_FORCE;

  source.vx += (dx / distance) * force;
  source.vy += (dy / distance) * force;
  target.vx -= (dx / distance) * force;
  target.vy -= (dy / distance) * force;
}

function fnApplySameBaseOrdering(bodies: TBody[], args: TFnLayoutStateMachineArgs): void {
  const clearance = args.clearance ?? DEFAULT_CLEARANCE;
  const minYGap = args.box.h + clearance;
  const grouped = new Map<string, TBody[]>();

  for (const body of bodies) {
    const baseName = fnBaseName(body.name);
    grouped.set(baseName, [...(grouped.get(baseName) ?? []), body]);
  }

  for (const group of grouped.values()) {
    if (group.length < 2) {
      continue;
    }

    const sorted = [...group].sort((left, right) => left.name.localeCompare(right.name));

    for (let index = 1; index < sorted.length; index += 1) {
      const previous = sorted[index - 1];
      const current = sorted[index];

      if (!previous || !current) {
        continue;
      }

      const targetY = previous.y + minYGap;
      const delta = targetY - current.y;

      if (delta <= 0) {
        continue;
      }

      previous.vy -= delta * 0.09;
      current.vy += delta * 0.09;
    }
  }
}

function fnIntegrate(body: TBody, args: TFnLayoutStateMachineArgs): void {
  const xRange = fnSafeRange(args.space.w, args.box.w, Math.max(18, Math.min(args.space.w, args.space.h) * 0.04));
  const yRange = fnSafeRange(args.space.h, args.box.h, Math.max(18, Math.min(args.space.w, args.space.h) * 0.04));

  body.vx = fnClamp(body.vx * DAMPING, -MAX_STEP, MAX_STEP);
  body.vy = fnClamp(body.vy * DAMPING, -MAX_STEP, MAX_STEP);
  body.x = fnClamp(body.x + body.vx, xRange.min, xRange.max);
  body.y = fnClamp(body.y + body.vy, yRange.min, yRange.max);
}

export function fnLayoutStateMachine(args: TFnLayoutStateMachineArgs): TFnLayoutPosition[] {
  const bodies = fnCreateBodies(args);
  const bodyByName = new Map(bodies.map((body) => [body.name, body]));
  const iterations = args.iterations ?? DEFAULT_ITERATIONS;

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    for (const body of bodies) {
      fnApplyAnchorForce(body);
      fnApplyBoundaryForce(body, args);
    }

    for (let leftIndex = 0; leftIndex < bodies.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < bodies.length; rightIndex += 1) {
        const left = bodies[leftIndex];
        const right = bodies[rightIndex];

        if (left && right) {
          fnApplyPairRepulsion(left, right, args);
        }
      }
    }

    for (const transition of args.transitions ?? []) {
      const source = bodyByName.get(transition.source);
      const target = bodyByName.get(transition.target);

      if (source && target && source !== target) {
        fnApplyTransitionSpring(source, target, args);
      }
    }

    fnApplySameBaseOrdering(bodies, args);

    for (const body of bodies) {
      fnIntegrate(body, args);
    }
  }

  return bodies.map((body) => ({
    name: body.name,
    x: args.space.w > 0 ? body.x / args.space.w : 0,
    y: args.space.h > 0 ? body.y / args.space.h : 0,
  }));
}
