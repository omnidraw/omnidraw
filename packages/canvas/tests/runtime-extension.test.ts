import { describe, expect, it } from "vitest";
import type { ICanvasRuntimeExtension } from "../src/extension";
import { createNewCanvasHarness } from "./new-test-setup";

describe("canvas runtime extensions", () => {
  it("installs and applies extensions in order, then disposes them in reverse order", async () => {
    const events: string[] = [];
    const extension = (name: string): ICanvasRuntimeExtension => ({
      name,
      install(context) {
        expect(context.services.scene).toBeDefined();
        events.push(`install:${name}`);
        return {
          plugins: [{
            name: `extension-${name}`,
            apply() {
              events.push(`apply:${name}`);
            },
          }],
          dispose() {
            events.push(`dispose:${name}`);
          },
        };
      },
    });

    const harness = await createNewCanvasHarness({
      extensions: [extension("first"), extension("second")],
    });

    expect(events).toEqual([
      "install:first",
      "install:second",
      "apply:first",
      "apply:second",
    ]);

    await harness.destroy();

    expect(events.slice(-2)).toEqual(["dispose:second", "dispose:first"]);
  });
});
