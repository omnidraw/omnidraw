/** The frontend and canvas renderer intentionally share one browser Repo lifecycle. */
export {
  cleanup,
  findDocument,
  getAllHandles,
  getHandle,
  getOrCreateRepo,
  loadPersistedDocuments,
  openAutomergeDocument,
  releaseAutomergeDocument,
  removeFromCache,
  switchAutomergeTenant,
  updateDocumentName,
} from '@vibecanvas/canvas/automerge';
