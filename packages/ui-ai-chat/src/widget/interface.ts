export type TWidgetTitleBarActionState = Readonly<{
  pressed?: boolean;
  disabled?: boolean;
  label?: string;
}>;

export type TWidgetTitleBarPortal = Readonly<{
  onAction(id: string, handler: () => void): () => void;
  setActionState(id: string, state: TWidgetTitleBarActionState): void;
}>;
