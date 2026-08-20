/** Await Solid 2's default microtask batch and effect application boundary. */
export async function settleSolidUpdate(): Promise<void> {
  await new Promise<void>((resolve) => queueMicrotask(resolve));
  await new Promise<void>((resolve) => queueMicrotask(resolve));
}
