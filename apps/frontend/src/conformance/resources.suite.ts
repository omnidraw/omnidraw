import { fxRows } from "@/core/resources/fx.db-resource";
import { txRename } from "@/core/resources/tx.db-resource";

export type TResourcesConformanceHarness = Readonly<{
  script(path: string, value: unknown): void;
  runRows(program: ReturnType<typeof fxRows>): Promise<unknown>;
  runRename(program: ReturnType<typeof txRename>): Promise<unknown>;
  records(): readonly Readonly<{ path: string; input: unknown }>[];
}>;

/** Same lazy read/write programs and JSON omission rules for both Layers. */
export async function resourcesConformanceSuite(harness: TResourcesConformanceHarness): Promise<void> {
  harness.script("resource.dbRows.list", { rows: [], nextCursor: null });
  await harness.runRows(fxRows({ resourceId: "resource-1", objectName: "notes", limit: 50 }));
  const first = harness.records()[0];
  if (first?.path !== "resource.dbRows.list") throw new Error("Resource read used the wrong operation.");
  if ("cursor" in (first.input as Record<string, unknown>)) throw new Error("Absent row cursor crossed transport.");

  harness.script("resource.resources.rename", { id: "resource-1", kind: "db", name: "Renamed", status: "ready", lastError: null, createdAtSec: "0", updatedAtSec: "0" });
  await harness.runRename(txRename({ resourceId: "resource-1", name: "Renamed" }));
  if (harness.records()[1]?.path !== "resource.resources.rename") throw new Error("Resource mutation used the wrong operation.");
}
