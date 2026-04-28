declare module "@arrow-js/core" {
  export function reactive<T extends object>(data: T): T;
}
