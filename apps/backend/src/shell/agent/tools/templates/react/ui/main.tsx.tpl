import { useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

function App() {
  const [count, setCount] = useState(0);
  return (
    <section className="omnidraw-widget">
      <p>Widget under construction</p>
      <output aria-live="polite">Local count: {count}</output>
      <button type="button" onClick={() => setCount((value) => value + 1)}>
        Increment
      </button>
    </section>
  );
}

const root = document.createElement("div");
root.className = "omnidraw-widget-root";
document.body.append(root);
createRoot(root).render(<App />);
