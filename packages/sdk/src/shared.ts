export type TOmnidrawJsonValue =
  | string
  | number
  | boolean
  | null
  | TOmnidrawJsonValue[]
  | { [key: string]: TOmnidrawJsonValue | undefined };

export type TUnsubscribe = () => void;

export type TSdkError = {
  readonly code: string;
  readonly message: string;
  readonly details?: TOmnidrawJsonValue;
};
