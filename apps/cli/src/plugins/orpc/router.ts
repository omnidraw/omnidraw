import { actorsHandlers } from '@vibecanvas/api-actors/handlers';
import { canvasHandlers } from '@vibecanvas/api-canvas/handlers';
import { agentHandlers } from '@vibecanvas/api-agent/handlers';
import { dbHandlers } from '@vibecanvas/api-db/handlers';
import { fileHandlers } from '@vibecanvas/api-file/handlers';
import { filesystemHandlers } from '@vibecanvas/api-filesystem/handlers';
import { notificationHandlers } from '@vibecanvas/api-notification/handlers';
import { ptyHandlers } from '@vibecanvas/api-pty/handlers';
import { toolHandlers } from '@vibecanvas/api-tool/handlers';

const router = {
  api: {
    actors: actorsHandlers,
    agent: agentHandlers,
    canvas: canvasHandlers,
    db: dbHandlers,
    file: fileHandlers,
    filesystem: filesystemHandlers,
    notification: notificationHandlers,
    pty: ptyHandlers,
    tool: toolHandlers,
  },
};

export { router };
