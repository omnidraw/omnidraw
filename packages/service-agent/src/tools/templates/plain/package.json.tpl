{
  "name": "__OMNIDRAW_WIDGET_SLUG__",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "vite build --config vite.config.mjs"
  },
  "dependencies": {
    "@omnidraw/capsule": "__OMNIDRAW_CAPSULE_DEPENDENCY__",
    "@omnidraw/sdk": "__OMNIDRAW_SDK_DEPENDENCY__",
    "zod": "4.4.3"
  },
  "overrides": {
    "@omnidraw/capsule": "__OMNIDRAW_CAPSULE_DEPENDENCY__"
  },
  "devDependencies": {
    "typescript": "5.9.3",
    "vite": "8.1.4"
  }
}
