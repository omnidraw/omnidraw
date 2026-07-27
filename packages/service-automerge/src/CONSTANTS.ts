export const AUTOMERGE_DOCUMENT_UNAVAILABLE_MESSAGE = 'Automerge document is unavailable.';

export const AUTOMERGE_CAPACITY_UNAVAILABLE_MESSAGE = 'Automerge service capacity is temporarily unavailable.';

export const DEFAULT_AUTOMERGE_MAX_ACTIVE_DOCUMENTS = 512;

export const DEFAULT_AUTOMERGE_DOCUMENT_IDLE_MS = 5 * 60 * 1000;

export const DEFAULT_AUTOMERGE_LIFECYCLE_SWEEP_MS = 30 * 1000;

export const AUTOMERGE_STORAGE_ADAPTER_ID = 'vibecanvas-cell-automerge';

export const MAX_AUTOMERGE_WEBSOCKET_FRAME_BYTES = 8 * 1024 * 1024;

export const MAX_AUTOMERGE_WEBSOCKET_CONNECTIONS = 1024;

export const MAX_AUTOMERGE_WEBSOCKET_CONNECTIONS_PER_ORGANIZATION = 256;

export const MAX_AUTOMERGE_PEER_ID_LENGTH = 256;

export const MAX_AUTOMERGE_PENDING_DOCUMENT_MESSAGES = 64;

export const MAX_AUTOMERGE_PENDING_DOCUMENT_BYTES = 16 * 1024 * 1024;

export const MAX_AUTOMERGE_PENDING_CONNECTION_MESSAGES = 64;

export const MAX_AUTOMERGE_PENDING_CONNECTION_BYTES = 16 * 1024 * 1024;

export const MAX_AUTOMERGE_PENDING_GLOBAL_MESSAGES = 512;

export const MAX_AUTOMERGE_PENDING_GLOBAL_BYTES = 64 * 1024 * 1024;

export const WIDGET_STATE_MUTATION_RATE_LIMIT = 20;

export const WIDGET_STATE_MUTATION_RATE_WINDOW_MS = 1000;

export const MAX_WIDGET_STATE_MUTATION_RATE_LEDGERS = 2048;

export const WIDGET_STATE_MUTATION_RESERVATION_TTL_MS = 30 * 1000;

export const MAX_WIDGET_STATE_MUTATION_RESERVATIONS_PER_DOCUMENT = 4096;

export const MAX_AUTOMERGE_DOCUMENT_WRITE_AUTHORITIES = 64;

export const MAX_WIDGET_COLLABORATIVE_STATE_BYTES = 64 * 1024;

// A legal 64 KiB JSON projection can carry Automerge encoding overhead, but one
// mutation must never smuggle an unbounded transient value into durable history.
export const MAX_WIDGET_COLLABORATIVE_STATE_ENCODED_CHANGE_BYTES = 256 * 1024;

export const MAX_WIDGET_COLLABORATIVE_STATE_INCREMENTAL_CHUNK_BYTES = 256 * 1024;

// This bounds both the bytes retained in collaboration_chunks and the sum of
// decoded Automerge changes. Snapshots may use the full quota for compaction.
export const MAX_WIDGET_COLLABORATIVE_STATE_DURABLE_BYTES = 4 * 1024 * 1024;

export const MAX_WIDGET_COLLABORATIVE_STATE_DEPTH = 32;

export const MAX_WIDGET_COLLABORATIVE_STATE_NODES = 10_000;
