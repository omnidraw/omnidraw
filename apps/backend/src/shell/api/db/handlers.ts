import { apiDbEvents } from './api.db-events';
import { baseDbOs } from './procedure-builder';

const dbHandlers = {
  events: apiDbEvents,
};

export { baseDbOs, dbHandlers };
