import type { Component } from "solid-js";
import styles from "../styles/route-state.module.css";

const WelcomePage: Component = () => {
  return (
    <div class={styles.root}>
      <div class={styles.panel}>
        <h2 class={styles.title}>Welcome to Vibecanvas</h2>
        <p class={styles.body}>
          Select a canvas from the sidebar or create a new one to get started.
        </p>
      </div>
    </div>
  );
};

export default WelcomePage;
