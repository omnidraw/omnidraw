# Arrow UI

Use `@arrow-js/core` for the browser UI. Keep ordinary interaction state local and reactive:

```ts
import { html, reactive } from "@arrow-js/core";
import "./styles.css";

const state = reactive({ count: 0 });
const increment = () => { state.count += 1; };

export default html`
  <button type="button" @click="${increment}">
    ${() => state.count}
  </button>
`;
```

- Put reactive reads inside `${() => ...}`.
- Use small event handlers and immutable or explicit local updates.
- Import static CSS from the UI graph.
- Use semantic elements, labels, keyboard access, and visible focus.
- Do not import server-only modules except a direct module that exports declared server functions; the trusted builder replaces that import with generated client proxies.
- Do not fetch an internal API, embed credentials, or access host files.
