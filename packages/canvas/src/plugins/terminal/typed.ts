import type { TOrpcSafeClient } from "@vibecanvas/orpc-client";
import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";

export type TTerminalTabPayload = {
  id: string;
  title: string;
  workingDirectory: string;
};

export type TTerminalWidgetPayload = {
  workingDirectory?: string;
  title?: string;
  activeTabId?: string | null;
  tabs?: TTerminalTabPayload[];
};

export type TTerminalWidgetMountArgs = {
  root: HTMLDivElement;
  element: TElement;
  apiService: TOrpcSafeClient;
  onPersist?: (payload: TTerminalWidgetPayload) => void;
};

export type TTerminalFolderNode = {
  name: string;
  path: string;
  is_dir: boolean;
  children: TTerminalFolderNode[];
};

export type TPtyLike = {
  id: string;
  title: string;
  command: string;
  args: string[];
  cwd: string;
  status: string;
  pid: number;
  rows: number;
  cols: number;
  exitCode: number | null;
  signalCode: string | null;
  createdAt: number;
  updatedAt: number;
};

export type TPtyImageFormat = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

export type TTerminalConnectionStatus = "idle" | "creating" | "connecting" | "connected" | "error" | "closed";
