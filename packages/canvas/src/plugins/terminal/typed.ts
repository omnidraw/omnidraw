import type { TOrpcSafeClient } from "@vibecanvas/orpc-client";
import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";

export type TTerminalWidgetPayload = {
  workingDirectory?: string;
  title?: string;
};

export type TTerminalWidgetMountArgs = {
  root: HTMLDivElement;
  element: TElement;
  apiService: TOrpcSafeClient;
};

export type TTerminalCwdDialogArgs = {
  container: HTMLElement;
  apiService: TOrpcSafeClient;
};

export type TTerminalCwdDialogResult = string | null;

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
