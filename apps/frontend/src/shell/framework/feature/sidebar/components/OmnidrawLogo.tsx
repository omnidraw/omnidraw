import type { Component } from 'solid-js';

export const OmnidrawLogo: Component<{ class?: string }> = (props) => (
  <svg
    class={props.class}
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 330 330"
    aria-hidden="true"
  >
    <defs>
      <linearGradient id="omnidraw-logo-ground" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#fdf9f6" />
        <stop offset="1" stop-color="#fbf8f5" />
      </linearGradient>
      <linearGradient id="omnidraw-logo-charcoal" x1="0" y1="0" x2="0.9" y2="1">
        <stop offset="0" stop-color="#1b1b1b" />
        <stop offset="1" stop-color="#202020" />
      </linearGradient>
      <linearGradient id="omnidraw-logo-amber" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#e8b64c" />
        <stop offset="1" stop-color="#e5b24b" />
      </linearGradient>
    </defs>

    <rect width="330" height="330" fill="url(#omnidraw-logo-ground)" />
    <g transform="translate(19 -10.5)">
      <path fill="url(#omnidraw-logo-charcoal)" d="M48 74h95v55H98v29H48z" />
      <path fill="url(#omnidraw-logo-charcoal)" d="M149 74h95v84h-48v-29h-47z" />
      <path fill="url(#omnidraw-logo-charcoal)" d="M48 164h50v59h93v46H48z" />
      <path fill="url(#omnidraw-logo-charcoal)" d="M196 164h48v113h-48z" />
      <rect x="48" y="269" width="143" height="8" fill="url(#omnidraw-logo-amber)" />
    </g>
  </svg>
);
