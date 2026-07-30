import { describe, expect, it } from 'vitest';
import {
  fnPlanWidgetCapsulePopulation,
  fnWidgetCapsulePopulationResourceClass,
  type TWidgetCapsulePopulationCandidate,
  type TWidgetCapsulePopulationMode,
  type TWidgetCapsulePopulationResourceClass,
} from '../../src/widget-runtime/fn.capsule-population';

const LIGHT = fnWidgetCapsulePopulationResourceClass([]);
const CANVAS_2D = fnWidgetCapsulePopulationResourceClass(['DOM', 'CANVAS_2D']);
const WEBGPU = fnWidgetCapsulePopulationResourceClass(['DOM', 'WEBGPU']);

function candidate(
  id: number,
  args: Readonly<{
    visibility?: 'visible' | 'hidden';
    priority?: number;
    distance?: number;
    hardFrozen?: boolean;
    currentMode?: TWidgetCapsulePopulationMode;
    resourceClass?: TWidgetCapsulePopulationResourceClass;
    artifactReady?: boolean;
    artifactLoading?: boolean;
    hiddenSinceMs?: number | null;
    farSinceMs?: number | null;
  }> = {},
): TWidgetCapsulePopulationCandidate {
  const visibility = args.visibility ?? 'visible';
  return Object.freeze({
    id: String(id),
    order: id,
    viewport: Object.freeze({
      width: 320,
      height: 240,
      scale: 1,
      visibility,
      distance: args.distance ?? 0,
      priority: args.priority ?? 0,
      occlusion: visibility === 'visible' ? 0 : 1,
    }),
    hardFrozen: args.hardFrozen ?? false,
    currentMode: args.currentMode ?? 'inert',
    resourceClass: args.resourceClass ?? LIGHT,
    artifactReady: args.artifactReady ?? true,
    artifactLoading: args.artifactLoading ?? false,
    blocked: false,
    hiddenSinceMs: args.hiddenSinceMs ?? null,
    farSinceMs: args.farSinceMs ?? null,
  });
}

describe('fnPlanWidgetCapsulePopulation', () => {
  it('bounds reprioritization and aggregate runnable admission', () => {
    const plan = fnPlanWidgetCapsulePopulation(
      Array.from({ length: 600 }, (_, index) => candidate(index)),
      0,
    );

    expect(plan.reprioritizationCandidateIds).toHaveLength(512);
    expect(plan.assignments).toHaveLength(24);
    expect(plan.counts).toEqual({
      active: 16,
      throttled: 8,
      frozen: 0,
      live: 24,
      heavy: 0,
      gpu: 0,
    });
  });

  it('admits no more than eight heavy and two GPU runtimes', () => {
    const candidates = [
      ...Array.from({ length: 5 }, (_, index) => candidate(index, {
        resourceClass: WEBGPU,
        priority: 100 - index,
      })),
      ...Array.from({ length: 10 }, (_, index) => candidate(index + 5, {
        resourceClass: CANVAS_2D,
        priority: 90 - index,
      })),
      ...Array.from({ length: 30 }, (_, index) => candidate(index + 15, {
        priority: 60 - index,
      })),
    ];

    expect(fnPlanWidgetCapsulePopulation(candidates, 0).counts).toEqual({
      active: 16,
      throttled: 8,
      frozen: 0,
      live: 24,
      heavy: 8,
      gpu: 2,
    });
  });

  it('keeps offscreen runtimes runnable for two seconds, then freezes only 16', () => {
    const nearOffscreen = Array.from({ length: 24 }, (_, index) => candidate(index, {
      visibility: 'hidden',
      distance: 100,
      currentMode: index < 16 ? 'active' : 'throttled',
      hiddenSinceMs: 0,
    }));

    const grace = fnPlanWidgetCapsulePopulation(nearOffscreen, 1_999);
    expect(grace.counts).toEqual({
      active: 16,
      throttled: 8,
      frozen: 0,
      live: 24,
      heavy: 0,
      gpu: 0,
    });
    expect(grace.nextWakeAtMs).toBe(2_000);

    const frozen = fnPlanWidgetCapsulePopulation(nearOffscreen, 2_000);
    expect(frozen.counts).toEqual({
      active: 0,
      throttled: 0,
      frozen: 16,
      live: 16,
      heavy: 0,
      gpu: 0,
    });
  });

  it('destroys far-offscreen runtimes at 30 seconds and ranks visible focus first', () => {
    const farOffscreen = Array.from({ length: 4 }, (_, index) => candidate(index, {
      visibility: 'hidden',
      distance: 3_000,
      currentMode: 'frozen',
      hiddenSinceMs: 0,
      farSinceMs: 0,
    }));
    expect(fnPlanWidgetCapsulePopulation(farOffscreen, 29_999).counts.frozen).toBe(4);
    expect(fnPlanWidgetCapsulePopulation(farOffscreen, 29_999).nextWakeAtMs).toBe(30_000);
    expect(fnPlanWidgetCapsulePopulation(farOffscreen, 30_000).counts.live).toBe(0);

    const ranked = fnPlanWidgetCapsulePopulation([
      candidate(0, { priority: 30 }),
      candidate(1, { priority: 90 }),
      candidate(2, { priority: 100 }),
      candidate(3, {
        visibility: 'hidden',
        currentMode: 'active',
        hiddenSinceMs: 0,
        priority: -50,
      }),
    ], 0);
    expect(ranked.assignments.map(({ id }) => id)).toEqual(['2', '1', '0', '3']);
  });

  it('discovers only the first 24 unknown runnable artifacts', () => {
    const unknown = fnWidgetCapsulePopulationResourceClass(null);
    const plan = fnPlanWidgetCapsulePopulation(
      Array.from({ length: 600 }, (_, index) => candidate(index, {
        resourceClass: unknown,
        artifactReady: false,
      })),
      0,
    );

    expect(plan.reprioritizationCandidateIds).toHaveLength(512);
    expect(plan.loadIds).toHaveLength(24);
    expect(plan.assignments).toHaveLength(0);
  });

  it('scans past classified resource-cap overflow for admissible widgets', () => {
    const unknown = fnWidgetCapsulePopulationResourceClass(null);
    const plan = fnPlanWidgetCapsulePopulation([
      ...Array.from({ length: 512 }, (_, index) => candidate(index, {
        resourceClass: WEBGPU,
      })),
      candidate(512, {
        resourceClass: unknown,
        artifactReady: false,
      }),
    ], 0);

    expect(plan.counts.gpu).toBe(2);
    expect(plan.counts.live).toBe(2);
    expect(plan.reprioritizationCandidateIds).toContain('512');
    expect(plan.loadIds).toEqual(['512']);
  });
});
