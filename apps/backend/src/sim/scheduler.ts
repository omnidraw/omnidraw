import type { Fiber, Scheduler } from 'effect';
import { fnCreateSeededRandom } from './fn.seeded-random';
import type { TSimulationScheduleChoice } from './types';

type TScheduledTask = {
  readonly task: () => void;
  readonly priority: number;
  readonly sequence: number;
};

export class SeededSimulationScheduler implements Scheduler.Scheduler {
  readonly executionMode = 'sync' as const;
  readonly #random: ReturnType<typeof fnCreateSeededRandom>;
  readonly #autoFlush: boolean;
  readonly #dispatchers: SimulationDispatcher[] = [];
  readonly #isReplay: boolean;
  readonly #replayChoices: readonly TSimulationScheduleChoice[];
  readonly #choices: TSimulationScheduleChoice[] = [];
  #nextDispatcher = 0;
  #nextTask = 0;

  constructor(seed: number, options: Readonly<{
    autoFlush?: boolean;
    replayChoices?: readonly TSimulationScheduleChoice[];
  }> = {}) {
    this.#random = fnCreateSeededRandom(seed);
    this.#autoFlush = options.autoFlush ?? true;
    this.#isReplay = options.replayChoices !== undefined;
    this.#replayChoices = options.replayChoices ?? [];
  }

  shouldYield(fiber: Fiber.Fiber<unknown, unknown>): boolean {
    return fiber.currentOpCount >= fiber.maxOpsBeforeYield;
  }

  makeDispatcher(): Scheduler.SchedulerDispatcher {
    const dispatcher = new SimulationDispatcher(
      this.#nextDispatcher++,
      () => this.#nextTask++,
      (args) => this.#select(args),
      this.#autoFlush,
    );
    this.#dispatchers.push(dispatcher);
    return dispatcher;
  }

  flush(): void {
    for (const dispatcher of this.#dispatchers) dispatcher.flush();
  }

  snapshot(): readonly TSimulationScheduleChoice[] {
    return Object.freeze(this.#choices.map((choice) => Object.freeze({
      ...choice,
      runnableSequences: Object.freeze([...choice.runnableSequences]),
    })));
  }

  assertReplayConsumed(): void {
    if (this.#isReplay && this.#replayChoices.length !== this.#choices.length) {
      throw new Error(
        `Scheduler replay consumed ${this.#choices.length} of ${this.#replayChoices.length} choices.`,
      );
    }
  }

  #select(args: Readonly<{
    dispatcherId: number;
    priority: number;
    runnableSequences: readonly number[];
  }>): number {
    const expected = this.#replayChoices[this.#choices.length];
    const selectedIndex = expected?.selectedIndex
      ?? this.#random.nextInt(`scheduler:${args.dispatcherId}`, args.runnableSequences.length);
    if (selectedIndex < 0 || selectedIndex >= args.runnableSequences.length) {
      throw new Error(`Scheduler replay selected invalid runnable index ${selectedIndex}.`);
    }
    const choice: TSimulationScheduleChoice = Object.freeze({
      sequence: this.#choices.length,
      dispatcherId: args.dispatcherId,
      priority: args.priority,
      runnableSequences: Object.freeze([...args.runnableSequences]),
      selectedIndex,
      selectedSequence: args.runnableSequences[selectedIndex]!,
    });
    if (expected !== undefined && !scheduleChoicesEqual(expected, choice)) {
      throw new Error(`Scheduler replay diverged at choice ${choice.sequence}.`);
    }
    this.#choices.push(choice);
    return selectedIndex;
  }
}

function scheduleChoicesEqual(left: TSimulationScheduleChoice, right: TSimulationScheduleChoice): boolean {
  return left.sequence === right.sequence
    && left.dispatcherId === right.dispatcherId
    && left.priority === right.priority
    && left.selectedIndex === right.selectedIndex
    && left.selectedSequence === right.selectedSequence
    && left.runnableSequences.length === right.runnableSequences.length
    && left.runnableSequences.every((value, index) => value === right.runnableSequences[index]);
}

class SimulationDispatcher implements Scheduler.SchedulerDispatcher {
  readonly #id: number;
  readonly #nextSequence: () => number;
  readonly #choose: (args: Readonly<{
    dispatcherId: number;
    priority: number;
    runnableSequences: readonly number[];
  }>) => number;
  readonly #autoFlush: boolean;
  readonly #tasks: TScheduledTask[] = [];
  #flushing = false;

  constructor(
    id: number,
    nextSequence: () => number,
    choose: (args: Readonly<{
      dispatcherId: number;
      priority: number;
      runnableSequences: readonly number[];
    }>) => number,
    autoFlush: boolean,
  ) {
    this.#id = id;
    this.#nextSequence = nextSequence;
    this.#choose = choose;
    this.#autoFlush = autoFlush;
  }

  scheduleTask(task: () => void, priority: number): void {
    this.#tasks.push({ task, priority, sequence: this.#nextSequence() });
    if (this.#autoFlush && !this.#flushing) this.flush();
  }

  flush(): void {
    if (this.#flushing) return;
    this.#flushing = true;
    try {
      while (this.#tasks.length > 0) {
        let lowest = Number.POSITIVE_INFINITY;
        for (const entry of this.#tasks) lowest = Math.min(lowest, entry.priority);
        const peers = this.#tasks.filter((entry) => entry.priority === lowest);
        const selected = peers[this.#choose({
          dispatcherId: this.#id,
          priority: lowest,
          runnableSequences: peers.map((entry) => entry.sequence),
        })]!;
        const selectedIndex = this.#tasks.findIndex((entry) => entry.sequence === selected.sequence);
        this.#tasks.splice(selectedIndex, 1);
        selected.task();
      }
    } finally {
      this.#flushing = false;
    }
  }

  get id(): number {
    return this.#id;
  }
}
