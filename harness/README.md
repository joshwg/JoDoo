# Sync test harness

End-to-end test of list synchronization: it builds and starts the **real Go
server** (on port 8199 with a throwaway data dir), then runs **two simulated
app clients** that create, share, join, edit, delete, and go offline/online
against each other, asserting after every scenario that both clients converge
to the same content.

The simulated clients are not a reimplementation of the sync logic: they
import the app's own `app/src/syncCore.ts` (item shapes, fingerprints, and
the item-level last-write-wins merge) and mirror the snapshot-handling
control flow of `app/src/syncManager.ts`. Only the storage layer (in-memory
maps instead of SQLite) and the UI are simulated.

## Running

```
cd harness
npm install   # once; installs tsx only
npm test
```

Requires Node >= 22 (built-in WebSocket and fetch) and Go (to build the
server). Exits 0 with `PASS - N checks` or 1 with the first failed assertion
and both clients' record sets dumped for diffing.

## Scenarios covered

- share a list, second client joins and receives content and name
- concurrent adds on both clients: both items survive on both, no duplicates
- concurrent edits to the same item: the later edit wins everywhere
- deletion propagates and leaves a tombstone (no resurrection)
- offline divergence: edits and deletions on both sides while one client is
  disconnected all merge correctly on reconnect
- done/undone flip conflict: later change wins
- a third client joins an active share mid-flight, edits, and its changes
  reach both peers
- restart catch-up: the third client exits, misses edits/adds/deletions from
  the other two, reconnects with its persisted state, and converges
- post-restart edits from the third client (edit, add, done-toggle) propagate
  to both other clients
