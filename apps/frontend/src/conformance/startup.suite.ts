import { txStartupCanvas } from "@/core/app/startup-canvas";

export type TStartupConformanceHarness = Readonly<{
  setCurrentRequest(requestId: number): void;
  runStartup(program: ReturnType<typeof txStartupCanvas>): Promise<void>;
  canvases(): readonly Readonly<{ id: string; name: string }>[];
  createCount(): number;
  navigations(): readonly Readonly<{ path: string }>[];
}>;

/** Same startup transaction proves fencing and create-once behavior. */
export async function startupConformanceSuite(harness: TStartupConformanceHarness): Promise<void> {
  harness.setCurrentRequest(2);
  await harness.runStartup(txStartupCanvas({ pathname: "/", requestId: 1 }));
  if (harness.canvases().length !== 0) throw new Error("A stale startup request mutated application state.");
  await harness.runStartup(txStartupCanvas({ pathname: "/", requestId: 2 }));
  await harness.runStartup(txStartupCanvas({ pathname: "/", requestId: 2 }));
  if (harness.createCount() !== 1 || harness.canvases().length !== 1) throw new Error("Startup did not create exactly one default canvas.");
  if (harness.navigations().length !== 1) throw new Error("Startup navigation was replayed or omitted.");
}
