import { ACTOR_CONNECTION_BOUNDARY_OFFSET } from './CONSTANTS';

export type TPoint = {
  x: number;
  y: number;
};

export function fnGetActorConnectionBoundaryPoint(args: { arc: number; width: number; height: number }): TPoint {
  const left = -ACTOR_CONNECTION_BOUNDARY_OFFSET;
  const top = -ACTOR_CONNECTION_BOUNDARY_OFFSET;
  const right = args.width + ACTOR_CONNECTION_BOUNDARY_OFFSET;
  const bottom = args.height + ACTOR_CONNECTION_BOUNDARY_OFFSET;
  const centerX = args.width / 2;
  const centerY = args.height / 2;
  const angle = args.arc * Math.PI * 2;
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const tx = dx > 0 ? (right - centerX) / dx : dx < 0 ? (left - centerX) / dx : Number.POSITIVE_INFINITY;
  const ty = dy > 0 ? (bottom - centerY) / dy : dy < 0 ? (top - centerY) / dy : Number.POSITIVE_INFINITY;
  const distance = Math.min(tx, ty);

  return { x: centerX + dx * distance, y: centerY + dy * distance };
}

export function fnReadActorConnectionArc(args: { style: Record<string, unknown>; key: 'sourceArc' | 'targetArc'; fallback: number }): number {
  const value = args.style[args.key];
  return typeof value === 'number' && Number.isFinite(value) ? value : args.fallback;
}

export function fnReadActorConnectionStroke(args: { style: Record<string, unknown>; fallback: string }): string {
  const value = args.style.stroke ?? args.style.color;
  return typeof value === 'string' && value.length > 0 ? value : args.fallback;
}
