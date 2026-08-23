import { createContext, useContext, type ParentComponent } from "solid-js";
import type { TFrontendRuntime } from "../runtime/frontend-runtime";

const FrontendRuntimeContext = createContext<TFrontendRuntime>();

export const FrontendRuntimeProvider: ParentComponent<{
  runtime: TFrontendRuntime;
}> = (props) => (
  <FrontendRuntimeContext value={props.runtime}>
    {props.children}
  </FrontendRuntimeContext>
);

export function useFrontendRuntime(): TFrontendRuntime {
  return useContext(FrontendRuntimeContext);
}
