export function fnCreateOrderedZIndex(index: number) {
  return `z${String(index).padStart(8, "0")}`;
}
