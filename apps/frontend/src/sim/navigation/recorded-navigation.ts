export type TRecordedNavigation = Readonly<{
  path: string;
  replace: boolean;
}>;

/** Deterministic navigation sink used by the simulated startup Layer. */
export class RecordedFrontendNavigation {
  readonly #entries: TRecordedNavigation[] = [];

  navigate(path: string, replace = false): void {
    this.#entries.push(Object.freeze({ path, replace }));
  }

  entries(): readonly TRecordedNavigation[] {
    return [...this.#entries];
  }
}
