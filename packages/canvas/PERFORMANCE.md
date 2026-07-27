# Canvas Performance

The ordinary edit path is proportional to changed scene nodes and changed JSON
paths:

- recorder entries identify changed node IDs;
- node diff walks only those before/after values;
- one client command contains the resulting primitive operations;
- one committed event becomes one `scene.apply` batch.

Complete scene replacement is reserved for initial load and explicit resync.
Do not add whole-scene signatures, polling, or scans to the ordinary edit path.

Keep these bounds observable:

- local history retains at most 100 entries;
- the server command and event limits remain authoritative;
- runtime replacement never overlaps engine instances;
- subscriptions and recorder listeners are released during shutdown;
- revision gaps trigger one snapshot reload rather than speculative repair.

Performance changes should include a focused test that measures work by changed
node count or patch count, not total canvas size.
