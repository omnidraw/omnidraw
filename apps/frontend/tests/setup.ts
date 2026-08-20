import { vi } from "vitest";

// jsdom does not implement this browser layout API. Kobalte uses it to keep
// the keyboard-focused collection item visible, so tests need the inert
// browser-shaped implementation rather than letting Solid halt reactivity.
Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
  configurable: true,
  value: vi.fn(),
  writable: true,
});

Object.defineProperty(window, "scrollTo", {
  configurable: true,
  value: vi.fn(),
  writable: true,
});
