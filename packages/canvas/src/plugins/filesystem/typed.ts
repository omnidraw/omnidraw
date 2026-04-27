import type { TOrpcSafeClient } from "@vibecanvas/orpc-client";
import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";

export type TFilesystemWidgetPayload = {
  rootPath?: string;
  openTabPaths?: string[];
  activePath?: string | null;
};

export type TFilesystemNode = {
  name: string;
  path: string;
  is_dir: boolean;
  is_unreadable?: boolean;
  unreadable_reason?: "permission_denied";
  children: TFilesystemNode[];
};

export type TFilesystemReadOutput =
  | { kind: "text"; content: string; truncated: boolean }
  | { kind: "binary"; content: string | null; size: number; mime?: string; encoding?: "base64" | "hex" }
  | { kind: "none"; size: number };

export type TFilesystemTab = {
  path: string;
  name: string;
  content: string;
  loading: boolean;
  saving: boolean;
  dirty: boolean;
  error: string | null;
  truncated: boolean;
  readonly: boolean;
};

export type TFilesystemWidgetState = {
  rootPath: string;
  rootChildren: TFilesystemNode[];
  openFolderPaths: string[];
  selectedPath: string | null;
  activePath: string | null;
  tabs: TFilesystemTab[];
  loadingTree: boolean;
  error: string | null;
};

export type TFilesystemWidgetMountArgs = {
  root: HTMLDivElement;
  element: TElement;
  apiService: TOrpcSafeClient;
  onPersist?: (payload: TFilesystemWidgetPayload) => void;
};
