import type { JSX } from "solid-js";
import styles from "./scroll-area.module.css";

type TScrollAreaProps = {
  class?: string;
  viewportClass?: string;
  children: JSX.Element;
};

export function ScrollArea(props: TScrollAreaProps) {
  const className = () => {
    return [styles.root, props.class, props.viewportClass].filter(Boolean).join(" ");
  };

  return (
    <div class={className()}>
      {props.children}
    </div>
  );
}
