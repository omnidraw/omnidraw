export type TWidgetMount = {
  name: string;
  source: 'draft';
  chatRoot: string;
  mountPath: string;
  targetPath: string;
};

export type TWidgetDraftWorkspaceEntry = {
  name: string;
  draftPath: string;
  published: boolean;
  revision: string;
  updatedAt: string;
};

export type TResolvedMountedPath = {
  absolutePath: string;
  widgetRoot: string;
  mount: TWidgetMount;
};

export type TWidgetCreateInput = {
  name: string;
  description?: string;
  template?: 'plain' | 'react';
  server?: boolean;
};

export type TAvailableWidget = {
  name: string;
  kind: 'widget' | null;
  hasDraft: boolean;
  hasPublished: boolean;
  mountedInThisChat: boolean;
  problemCode: string | null;
};

export type TWorkspaceGrepMatch = {
  path: string;
  line: number;
  text: string;
};

export type TWorkspaceGrepResult = {
  matches: TWorkspaceGrepMatch[];
  truncated: boolean;
  filesSearched: number;
};
