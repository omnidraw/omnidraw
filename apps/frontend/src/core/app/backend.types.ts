/** Frontend-owned DTOs received from the private application transport. */
export type TCanvasId = string;

export type TBackendCanvas = Readonly<{
  id: string;
  name: string;
  revision?: number;
  createdAtSec?: string;
  updatedAtSec?: string;
}>;

export type TBackendResource = Readonly<{
  id: string;
  kind: "kv" | "secretStore" | "db";
  name: string;
  status: "created" | "provisioning" | "ready" | "migrating" | "error" | "deleting";
  lastError: unknown | null;
  createdAtSec: string;
  updatedAtSec: string;
}>;

export type TNotificationEvent = Readonly<{
  id?: string;
  type: "error" | "success" | "warning" | "info";
  title: string;
  description?: string;
}>;
