import type { CapsuleViewport } from '@omnidraw/capsule-omnidraw/host';
import {
  WIDGET_UI_FAR_OFFSCREEN_DESTROY_MS,
  WIDGET_UI_GPU_APIS,
  WIDGET_UI_HEAVY_APIS,
  WIDGET_UI_MAX_ACTIVE_RUNTIMES,
  WIDGET_UI_MAX_FROZEN_RUNTIMES,
  WIDGET_UI_MAX_GPU_RUNTIMES,
  WIDGET_UI_MAX_HEAVY_RUNTIMES,
  WIDGET_UI_MAX_LIVE_RUNTIMES,
  WIDGET_UI_MAX_REPRIORITIZATION_CANDIDATES,
  WIDGET_UI_MAX_THROTTLED_RUNTIMES,
  WIDGET_UI_OFFSCREEN_FREEZE_GRACE_MS,
} from './CONSTANTS';

export type TWidgetCapsulePopulationMode =
  | 'inert'
  | 'active'
  | 'throttled'
  | 'frozen';

export type TWidgetCapsulePopulationResourceClass = Readonly<{
  known: boolean;
  heavy: boolean;
  gpu: boolean;
}>;

export type TWidgetCapsulePopulationCandidate = Readonly<{
  id: string;
  order: number;
  viewport: CapsuleViewport;
  hardFrozen: boolean;
  currentMode: TWidgetCapsulePopulationMode;
  resourceClass: TWidgetCapsulePopulationResourceClass;
  artifactReady: boolean;
  artifactLoading: boolean;
  blocked: boolean;
  hiddenSinceMs: number | null;
  farSinceMs: number | null;
}>;

export type TWidgetCapsulePopulationAssignment = Readonly<{
  id: string;
  mode: Exclude<TWidgetCapsulePopulationMode, 'inert'>;
}>;

export type TWidgetCapsulePopulationPlan = Readonly<{
  assignments: readonly TWidgetCapsulePopulationAssignment[];
  reprioritizationCandidateIds: readonly string[];
  loadIds: readonly string[];
  nextWakeAtMs: number | null;
  counts: Readonly<{
    active: number;
    throttled: number;
    frozen: number;
    live: number;
    heavy: number;
    gpu: number;
  }>;
}>;

const UNKNOWN_RESOURCE_CLASS: TWidgetCapsulePopulationResourceClass = Object.freeze({
  known: false,
  heavy: false,
  gpu: false,
});

type TMutableCounts = {
  active: number;
  throttled: number;
  frozen: number;
  live: number;
  heavy: number;
  gpu: number;
};

function elapsed(nowMs: number, sinceMs: number | null): number {
  if (sinceMs === null || nowMs < sinceMs) return 0;
  return nowMs - sinceMs;
}

function compareCandidates(
  left: TWidgetCapsulePopulationCandidate,
  right: TWidgetCapsulePopulationCandidate,
): number {
  const visibility = Number(right.viewport.visibility === 'visible')
    - Number(left.viewport.visibility === 'visible');
  if (visibility !== 0) return visibility;
  if (left.viewport.priority !== right.viewport.priority) {
    return right.viewport.priority - left.viewport.priority;
  }
  if (left.viewport.occlusion !== right.viewport.occlusion) {
    return left.viewport.occlusion - right.viewport.occlusion;
  }
  if (left.viewport.distance !== right.viewport.distance) {
    return left.viewport.distance - right.viewport.distance;
  }
  return left.order - right.order;
}

function canAssign(
  counts: TMutableCounts,
  mode: Exclude<TWidgetCapsulePopulationMode, 'inert'>,
  resourceClass: TWidgetCapsulePopulationResourceClass,
): boolean {
  if (!resourceClass.known || counts.live >= WIDGET_UI_MAX_LIVE_RUNTIMES) return false;
  if (mode === 'active' && counts.active >= WIDGET_UI_MAX_ACTIVE_RUNTIMES) return false;
  if (
    mode === 'throttled'
    && counts.throttled >= WIDGET_UI_MAX_THROTTLED_RUNTIMES
  ) return false;
  if (mode === 'frozen' && counts.frozen >= WIDGET_UI_MAX_FROZEN_RUNTIMES) return false;
  if (resourceClass.heavy && counts.heavy >= WIDGET_UI_MAX_HEAVY_RUNTIMES) return false;
  return !resourceClass.gpu || counts.gpu < WIDGET_UI_MAX_GPU_RUNTIMES;
}

function assign(
  assignments: TWidgetCapsulePopulationAssignment[],
  assignedIds: Set<string>,
  counts: TMutableCounts,
  candidate: TWidgetCapsulePopulationCandidate,
  mode: Exclude<TWidgetCapsulePopulationMode, 'inert'>,
): boolean {
  if (assignedIds.has(candidate.id) || !canAssign(counts, mode, candidate.resourceClass)) {
    return false;
  }
  assignments.push(Object.freeze({ id: candidate.id, mode }));
  assignedIds.add(candidate.id);
  counts[mode] += 1;
  counts.live += 1;
  if (candidate.resourceClass.heavy) counts.heavy += 1;
  if (candidate.resourceClass.gpu) counts.gpu += 1;
  return true;
}

function nextDeadline(
  current: number | null,
  value: number | null,
  nowMs: number,
): number | null {
  if (value === null || value <= nowMs) return current;
  return current === null ? value : Math.min(current, value);
}

function reprioritizationCandidates(
  candidates: readonly TWidgetCapsulePopulationCandidate[],
): readonly TWidgetCapsulePopulationCandidate[] {
  const selected: TWidgetCapsulePopulationCandidate[] = [];
  let knownHeavy = 0;
  let knownGpu = 0;
  for (const candidate of candidates) {
    if (candidate.resourceClass.known) {
      if (
        candidate.resourceClass.gpu
        && knownGpu >= WIDGET_UI_MAX_GPU_RUNTIMES
      ) continue;
      if (
        candidate.resourceClass.heavy
        && knownHeavy >= WIDGET_UI_MAX_HEAVY_RUNTIMES
      ) continue;
      if (candidate.resourceClass.gpu) knownGpu += 1;
      if (candidate.resourceClass.heavy) knownHeavy += 1;
    }
    selected.push(candidate);
    if (selected.length >= WIDGET_UI_MAX_REPRIORITIZATION_CANDIDATES) break;
  }
  return selected;
}

export function fnWidgetCapsulePopulationResourceClass(
  apis: readonly string[] | null,
): TWidgetCapsulePopulationResourceClass {
  if (apis === null) return UNKNOWN_RESOURCE_CLASS;
  const heavy = apis.some((api) => (
    WIDGET_UI_HEAVY_APIS.includes(api)
  ));
  const gpu = apis.some((api) => (
    WIDGET_UI_GPU_APIS.includes(api)
  ));
  return Object.freeze({ known: true, heavy, gpu });
}

export function fnPlanWidgetCapsulePopulation(
  candidates: readonly TWidgetCapsulePopulationCandidate[],
  nowMs: number,
): TWidgetCapsulePopulationPlan {
  const ordered = [...candidates].filter((candidate) => !candidate.blocked)
    .sort(compareCandidates);
  const live = ordered.filter((candidate) => candidate.currentMode !== 'inert');
  const waiting = reprioritizationCandidates(ordered.filter((candidate) => (
    candidate.currentMode === 'inert'
    && candidate.viewport.visibility === 'visible'
    && !candidate.hardFrozen
  )));
  const eligible = [
    ...live,
    ...waiting,
  ].filter((candidate, index, values) => (
    values.findIndex(({ id }) => id === candidate.id) === index
  ));

  const assignments: TWidgetCapsulePopulationAssignment[] = [];
  const assignedIds = new Set<string>();
  const counts: TMutableCounts = {
    active: 0,
    throttled: 0,
    frozen: 0,
    live: 0,
    heavy: 0,
    gpu: 0,
  };

  const visibleRunnable = eligible.filter((candidate) => (
    candidate.viewport.visibility === 'visible'
    && !candidate.hardFrozen
    && candidate.resourceClass.known
  )).sort(compareCandidates);
  for (const candidate of visibleRunnable) {
    assign(assignments, assignedIds, counts, candidate, 'active');
  }
  for (const candidate of visibleRunnable) {
    assign(assignments, assignedIds, counts, candidate, 'throttled');
  }

  const hiddenGrace = live.filter((candidate) => (
    candidate.viewport.visibility === 'hidden'
    && !candidate.hardFrozen
    && elapsed(nowMs, candidate.hiddenSinceMs) < WIDGET_UI_OFFSCREEN_FREEZE_GRACE_MS
    && elapsed(nowMs, candidate.farSinceMs) < WIDGET_UI_FAR_OFFSCREEN_DESTROY_MS
    && candidate.resourceClass.known
  )).sort(compareCandidates);
  for (const candidate of hiddenGrace) {
    const preferred = candidate.currentMode === 'throttled' ? 'throttled' : 'active';
    if (!assign(assignments, assignedIds, counts, candidate, preferred)) {
      assign(
        assignments,
        assignedIds,
        counts,
        candidate,
        preferred === 'active' ? 'throttled' : 'active',
      );
    }
  }

  const frozen = live.filter((candidate) => {
    if (assignedIds.has(candidate.id) || !candidate.resourceClass.known) return false;
    if (candidate.viewport.visibility === 'visible') return candidate.hardFrozen;
    if (
      candidate.farSinceMs !== null
      && elapsed(nowMs, candidate.farSinceMs) >= WIDGET_UI_FAR_OFFSCREEN_DESTROY_MS
    ) return false;
    return candidate.hardFrozen
      || elapsed(nowMs, candidate.hiddenSinceMs) >= WIDGET_UI_OFFSCREEN_FREEZE_GRACE_MS
      || candidate.currentMode === 'frozen';
  }).sort(compareCandidates);
  for (const candidate of frozen) {
    assign(assignments, assignedIds, counts, candidate, 'frozen');
  }

  const assignmentIds = new Set(assignments.map(({ id }) => id));
  const assignedLoads = eligible.filter((candidate) => (
    assignmentIds.has(candidate.id)
    && !candidate.artifactReady
  ));
  const unknownDiscovery = waiting.filter((candidate) => (
    !candidate.resourceClass.known
    && !candidate.artifactReady
  )).slice(0, Math.max(0, WIDGET_UI_MAX_LIVE_RUNTIMES - counts.live));
  const loadIds = [...assignedLoads, ...unknownDiscovery]
    .filter((candidate, index, values) => (
      values.findIndex(({ id }) => id === candidate.id) === index
    ))
    .sort(compareCandidates)
    .map(({ id }) => id);

  let nextWakeAtMs: number | null = null;
  for (const candidate of live) {
    if (candidate.viewport.visibility !== 'hidden') continue;
    if (!candidate.hardFrozen && candidate.hiddenSinceMs !== null) {
      nextWakeAtMs = nextDeadline(
        nextWakeAtMs,
        candidate.hiddenSinceMs + WIDGET_UI_OFFSCREEN_FREEZE_GRACE_MS,
        nowMs,
      );
    }
    if (candidate.farSinceMs !== null) {
      nextWakeAtMs = nextDeadline(
        nextWakeAtMs,
        candidate.farSinceMs + WIDGET_UI_FAR_OFFSCREEN_DESTROY_MS,
        nowMs,
      );
    }
  }

  return Object.freeze({
    assignments: Object.freeze(assignments),
    reprioritizationCandidateIds: Object.freeze(waiting.map(({ id }) => id)),
    loadIds: Object.freeze(loadIds),
    nextWakeAtMs,
    counts: Object.freeze({ ...counts }),
  });
}
