import { baseWidgetOs } from './procedure-builder';
import { throwWidgetDeletionApiError } from './api.filesystem-error';

const apiWidgetDeletionPlan = baseWidgetOs.deletion.plan.handler(async ({
  context,
  input,
}) => {
  try {
    return await context.widgetCatalog.planDeletion(input);
  } catch (error) {
    throwWidgetDeletionApiError(error);
  }
});

const apiWidgetDeletionCommit = baseWidgetOs.deletion.commit.handler(async ({
  context,
  input,
  signal,
}) => {
  try {
    return await context.widgetCatalog.commitDeletion({ ...input, signal });
  } catch (error) {
    throwWidgetDeletionApiError(error);
  }
});

export {
  apiWidgetDeletionCommit,
  apiWidgetDeletionPlan,
};
