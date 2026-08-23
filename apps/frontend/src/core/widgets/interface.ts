export type TWidgetTitleBarActionState = Readonly<{
  pressed?: boolean;
  disabled?: boolean;
  hidden?: boolean;
  label?: string;
  content?: string;
}>;

export type TWidgetTitleBarPortal = Readonly<{
  onAction(id: string, handler: () => void): () => void;
  setActionState(id: string, state: TWidgetTitleBarActionState): void;
}>;
