import { createContext, useContext, type ParentComponent } from "solid-js";
import type { TFrontendRuntime } from "../runtime/frontend-runtime";

const FrontendRuntimeContext = createContext<TFrontendRuntime>();

export const FrontendRuntimeProvider: ParentComponent<{
  runtime: TFrontendRuntime;
}> = (props) => (
  <FrontendRuntimeContext.Provider value={props.runtime}>
    {props.children}
  </FrontendRuntimeContext.Provider>
);

export function useFrontendRuntime(): TFrontendRuntime {
  const runtime = useContext(FrontendRuntimeContext);
  if (runtime === undefined) {
    throw new Error("Frontend runtime context is unavailable.");
  }
  return runtime;
}
