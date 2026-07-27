import { apiDbEvents } from './api.db-events';
import { baseDbOs } from './orpc';

const dbHandlers = {
  events: apiDbEvents,
};

export { baseDbOs, dbHandlers };
