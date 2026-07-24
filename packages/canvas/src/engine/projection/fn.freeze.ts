import { fnIsPersistentRecord } from "./fn.persistent-record";
import { fnIsPersistentSequence } from "./fn.persistent-sequence";

type TArgs<TValue> = {
  value: TValue;
};

function freezeValue<TValue>(
  value: TValue,
  visited: WeakSet<object>,
): TValue {
  if (typeof value !== "object" || value === null || visited.has(value)) {
    return value;
  }
  if (fnIsPersistentRecord(value) || fnIsPersistentSequence(value)) {
    return value;
  }

  visited.add(value);
  for (const child of Object.values(value)) {
    freezeValue(child, visited);
  }
  return Object.freeze(value);
}

export function fnFreezeCanvasProjectionValue<TValue>(
  args: TArgs<TValue>,
): TValue {
  return freezeValue(args.value, new WeakSet());
}
