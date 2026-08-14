import { CANVAS_SCENE_SCHEMA_VERSION } from '@omnidraw/canvas-contract';
import { WIDGET_MANIFEST_V1_SCHEMA_URL } from '@omnidraw/sdk/contract';
import sdkPackage from '@omnidraw/sdk/package.json';

const server = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  fetch() {
    return Response.json({
      pid: process.pid,
      sdkVersion: sdkPackage.version,
      canvasSchemaVersion: CANVAS_SCENE_SCHEMA_VERSION,
      widgetSchemaUrl: WIDGET_MANIFEST_V1_SCHEMA_URL,
    });
  },
});

process.stdout.write(`READY ${server.port} ${process.pid}\n`);

process.once('SIGTERM', () => {
  void server.stop(true).finally(() => process.exit(0));
});
