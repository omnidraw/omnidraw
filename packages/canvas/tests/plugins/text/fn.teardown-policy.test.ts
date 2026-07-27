import { describe, expect, it } from "vitest";
import { fnTextEditorTeardownOutcome } from "../../../src/plugins/text/fn.teardown-policy";

describe("text editor teardown policy", () => {
  it.each([
    {
      name: "new empty",
      args: { creation: true, initialText: "", currentText: "" },
      outcome: "cancel",
    },
    {
      name: "new meaningful",
      args: { creation: true, initialText: "", currentText: "created" },
      outcome: "commit",
    },
    {
      name: "existing unchanged",
      args: { creation: false, initialText: "same", currentText: "same" },
      outcome: "close",
    },
    {
      name: "existing modified",
      args: { creation: false, initialText: "before", currentText: "after" },
      outcome: "commit",
    },
  ])("resolves $name text as $outcome", ({ args, outcome }) => {
    expect(fnTextEditorTeardownOutcome(args)).toBe(outcome);
  });
});
