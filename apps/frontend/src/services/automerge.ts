/** The frontend and canvas renderer intentionally share one browser Repo lifecycle. */
export {
  cleanup,
  findDocument,
  getAllHandles,
  getHandle,
  getOrCreateRepo,
  loadPersistedDocuments,
  removeFromCache,
  switchAutomergeTenant,
  updateDocumentName,
} from '@vibecanvas/canvas/automerge';
