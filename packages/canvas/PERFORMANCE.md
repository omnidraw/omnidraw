# Canvas Performance

The synchronous controlled-mutation path is latency-sensitive:

- Cangine supplies one immutable command batch and its affected IDs;
- the local reducer stages one optimistic successor and retains bounded
  before/after images for affected nodes;
- authored-node diff walks only those bounded images and changed JSON paths;
- the document installs one pending record and performs exactly one
  `scene.apply()` before returning; and
- transport execution, upload, and collaboration reconciliation remain
  asynchronous.

Complete scene replacement is reserved for initial load and explicit resync.
Do not add network waits, media waits, recorder capture, whole-scene
serialization, polling, or extra render publications to the synchronous path.

Prepared images render from their retained Blob first. Upload runs in the
background, and successful durable-URL promotion is one later local
transaction. The media gate may delay server commands, but must never delay the
initial local projection or receipt.

Keep these bounds observable:

- local history retains at most 100 entries;
- before/after images and server plans are limited to affected nodes;
- one ordinary editor action normally creates one pending transaction and one
  server command;
- continuous selection-style changes retain only the latest value per host
  animation frame, while gesture completion synchronously flushes the exact
  final controlled mutation under one history-coalescing key;
- accepted rows and optimistic nodes remain separate maps with one entry per
  document node;
- the server command and event limits remain authoritative;
- runtime replacement never overlaps engine instances;
- subscriptions, resource registrations, and adopted image retains are released
  during shutdown;
- revision gaps trigger one snapshot reload rather than speculative repair.

Performance changes should include focused measurements for synchronous commit
latency, affected-node/patch count, pending-ledger depth, and total canvas size.
Any new whole-document work in the ordinary local edit path must be called out
explicitly.
