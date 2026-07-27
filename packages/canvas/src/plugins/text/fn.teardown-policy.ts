export type TTextEditorTeardownOutcome = "cancel" | "close" | "commit";

export function fnTextEditorTeardownOutcome(args: {
  creation: boolean;
  initialText: string;
  currentText: string;
}): TTextEditorTeardownOutcome {
  if (args.currentText !== args.initialText) {
    return "commit";
  }
  return args.creation ? "cancel" : "close";
}
