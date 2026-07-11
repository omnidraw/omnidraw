import { apiCreateToolGroup } from "./api.create-tool-group";
import { apiGetToolGroup } from "./api.get-tool-group";
import { apiListToolGroups } from "./api.list-tool-groups";
import { apiRemoveToolGroup } from "./api.remove-tool-group";
import { apiUpdateToolGroup } from "./api.update-tool-group";
import { baseToolOs } from "./orpc";

const toolHandlers = {
  groups: {
    list: apiListToolGroups,
    get: apiGetToolGroup,
    create: apiCreateToolGroup,
    update: apiUpdateToolGroup,
    remove: apiRemoveToolGroup,
  },
};

export { baseToolOs, toolHandlers };
