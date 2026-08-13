import type {
  TWidgetImportWorkspacePortConfig,
  TWidgetImportWorkspacePorts,
  TWidgetPreviewWorkspacePorts,
  TWidgetWorkspaceWriterLeasePort,
} from './typed';
import type { NodeWidgetFilesystemWorkspace } from './NodeWidgetFilesystemWorkspace';

export function createWidgetImportWorkspacePorts<TCheckout>(args: Readonly<{
  workspace: NodeWidgetFilesystemWorkspace;
  config: TWidgetImportWorkspacePortConfig<TCheckout>;
}>): TWidgetImportWorkspacePorts<TCheckout> {
  return Object.freeze({
    listDraftDirectoryNames: (input) => args.workspace.listDraftDirectoryNames(input),
    prepareStaging: (input) => args.workspace.prepareStaging(input),
    copyCheckout: (input) => args.workspace.copyExternalCheckout({
      sourceRootPath: args.config.checkoutRootPath(input.checkout),
      destinationRelativePath: input.destinationRelativePath,
      mode: input.mode,
      signal: input.signal,
    }).then(() => undefined),
    observeManagedTree: (input) => args.workspace.observeManagedTree(input),
    captureManagedTree: (input) => args.workspace.captureManagedTree(input),
    inspectManagedManifest: (input) => args.workspace.inspectManagedManifest(input),
    promoteStaging: (input) => args.workspace.promoteStaging(input),
    removeManagedPath: (input) => args.workspace.removeManagedPath(input),
  });
}

export function createWidgetPreviewWorkspacePorts(args: Readonly<{
  workspace: NodeWidgetFilesystemWorkspace;
  writer: TWidgetWorkspaceWriterLeasePort;
}>): TWidgetPreviewWorkspacePorts {
  return Object.freeze({
    async prepareTempPath(input) {
      const lease = await args.writer.acquireWriterLease({ signal: input.signal });
      try {
        await args.workspace.prepareTempPath(input);
      } finally {
        await lease.release();
      }
    },
    async removeTempPath(input) {
      const lease = await args.writer.acquireWriterLease({});
      try {
        await args.workspace.removeTempPath(input);
      } finally {
        await lease.release();
      }
    },
  });
}
