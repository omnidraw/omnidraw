{
  "name": "__OMNIDRAW_WIDGET_SLUG__",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "check": "omnidraw-widget check .",
    "build": "omnidraw-widget build ."
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
