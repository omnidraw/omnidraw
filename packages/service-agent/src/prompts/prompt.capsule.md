# Capsule UI

Widget UI runs as untrusted code inside Capsule. Plain DOM is the default and
normal UI libraries may be used only when their pinned packages and requested
Capsule profiles are supported by the trusted build.

```ts
import "./styles.css";

const root = document.createElement("section");
root.className = "counter-widget";

const output = document.createElement("output");
let count = 0;
const render = () => { output.textContent = `Count: ${count}`; };

const button = document.createElement("button");
button.type = "button";
button.textContent = "Increment";
button.addEventListener("click", () => {
  count += 1;
  render();
});

root.append(output, button);
document.body.append(root);
render();
```

React is the supported component-library path. When React materially simplifies
the widget:

- Use a `.tsx` UI entry and set TypeScript `jsx` to `react-jsx`.
- Pin `react` and `react-dom` to exactly `19.2.7`; pin `@types/react` to exactly
  `19.2.17` and `@types/react-dom` to exactly `19.2.3`. Do not use ranges.
- Import only the public authoring entrypoints: `react` and
  `react-dom/client`. JSX runtime imports are generated automatically.
- Do not select a transform plugin in widget source or the manifest. The
  trusted build selects Capsule's reviewed React JSX plugin for `.tsx`/`.jsx`
  entries and admits only its closed, digest-checked package projection.

Other UI libraries are unsupported until the trusted build pins and projects
them. Do not substitute a CDN, remote ESM endpoint, vendored minified runtime,
or runtime package loader.

- `dom-core-v2` is the normal DOM profile. Static CSS and image imports require
  the matching `artifact-resources-*` feature profile. Selection, SVG, Canvas
  2D, WebGL, WebGPU, media, clipboard, dialogs, user files, and buffered fetch
  require explicit supported profiles and may still be reduced or denied by
  host policy.
- Keep transient interaction state local. Use semantic elements, labels,
  keyboard access, and visible focus.
- Import static CSS from the closed UI dependency graph. There is no runtime
  package installation or dynamic import.
- Use `@vibecanvas/sdk/widget` for host-observed props, theme, lifecycle,
  output, bounded local state, collaborative state, and generated
  server-function clients. Do not import `@omnidraw/capsule/guest` directly.
- `getWidgetTheme()` returns the fixed safe semantic theme projection. Emit
  host UI only through
  `emitWidgetOutput({ type: "notification", tone: "info" | "success" | "error", message })`;
  no other output action is available.
- Do not invent capability selectors, contract hashes, signing key ids,
  instance ids, or resource ids. Trusted build and host wiring own them.
- Do not access host files, internal APIs, ambient credentials, or direct
  network/resource authority. A requested profile is compatibility, not a
  grant.
