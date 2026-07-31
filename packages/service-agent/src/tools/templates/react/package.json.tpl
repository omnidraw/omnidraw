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
    "react": "19.2.7",
    "react-dom": "19.2.7",
    "zod": "4.4.3"
  },
  "overrides": {
    "@omnidraw/capsule": "__OMNIDRAW_CAPSULE_DEPENDENCY__"
  },
  "devDependencies": {
    "@types/react": "19.2.17",
    "@types/react-dom": "19.2.3",
    "typescript": "5.9.3",
    "vite": "8.1.4"
  }
}
