import { createMemo, createSignal, For } from "solid-js";
import { render } from "solid-js/web";
import { ActorStateMachineView } from "../src";
import { DEMO_ACTORS } from "./actors";
import "../src/styles.css";
import "./styles.css";

function DemoApp() {
  const [selectedSlug, setSelectedSlug] = createSignal(DEMO_ACTORS[0]?.slug ?? "");
  const selectedActor = createMemo(() => DEMO_ACTORS.find((actor) => actor.slug === selectedSlug()) ?? DEMO_ACTORS[0]);

  return (
    <main class="vc-actor-demo">
      <header class="vc-actor-demo__header">
        <div>
          <p class="vc-actor-demo__eyebrow">Vibecanvas actor-ui</p>
          <h1>State machine inspector</h1>
        </div>
        <label class="vc-actor-demo__select">
          <span>Actor</span>
          <select value={selectedSlug()} onInput={(event) => setSelectedSlug(event.currentTarget.value)}>
            <For each={DEMO_ACTORS}>
              {(actor) => <option value={actor.slug}>{actor.name}</option>}
            </For>
          </select>
        </label>
      </header>

      <p class="vc-actor-demo__description">{selectedActor()?.description}</p>

      <ActorStateMachineView manifest={selectedActor()} />
    </main>
  );
}

const root = document.getElementById("root");

if (!root) {
  throw new Error("Missing #root element");
}

render(() => <DemoApp />, root);
