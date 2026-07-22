export type TWidgetCollaborativeStateIdentity = Readonly<{
  orgId: string;
  canvasId: string;
  elementId: string;
  widgetInstanceId: string;
  definitionId: string;
  revisionId: string;
  stateDocumentId: string;
}>;

export type TWidgetCollaborativeStateDocument = Readonly<{
  schemaVersion: 1;
  identity: TWidgetCollaborativeStateIdentity;
  state: unknown;
}>;

export type TAutomergeDocumentAccess =
  | Readonly<{
    kind: 'canvas';
    orgId: string;
    canvasId: string;
  }>
  | Readonly<{
    kind: 'widget-state';
    orgId: string;
    canvasId: string;
    identity: TWidgetCollaborativeStateIdentity;
  }>;

export type TAutomergeDocumentAuthorization = Readonly<{
  access: TAutomergeDocumentAccess;
  canWrite: boolean;
}>;
