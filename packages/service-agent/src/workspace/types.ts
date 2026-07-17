export type TWidgetMount = {
  name: string;
  source: 'draft';
  chatRoot: string;
  mountPath: string;
  targetPath: string;
};

export type TResolvedMountedPath = {
  absolutePath: string;
  widgetRoot: string;
  mount: TWidgetMount;
};

export type TWidgetCreateInput = {
  name: string;
  kind: 'widget' | 'actor-widget';
  description?: string;
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
