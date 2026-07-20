import * as db from './db';
import { emitRemoteUpdate } from './remoteUpdates';
import { getServerConfig } from './serverConfig';
import { RemoteItem, ShareConnection, SharePayload } from './syncClient';

export { SHOPPING_SHARE_KEY_SETTING } from './db';

interface ManagedConnection {
  kind: 'todo' | 'shopping';
  listId?: number;
  conn: ShareConnection;
}

let connections: ManagedConnection[] = [];

function closeAll(): void {
  for (const c of connections) c.conn.close();
  connections = [];
}

function toRemoteItems(items: db.SyncTaskItem[] | db.SyncShoppingItem[]): RemoteItem[] {
  return items as unknown as RemoteItem[];
}

// The item-level merge itself (mergeRecords and friends) lives in
// syncCore.ts, re-exported through db, so the test harness exercises the
// exact code used here.

/** The list name has no per-item timestamp, so it falls back to the
 *  list-level dirty flag and edit time: an unmodified local name always
 *  adopts the remote one; a locally renamed list keeps its name unless the
 *  remote edit is at least as recent. */
function resolveListName(
  snapshot: SharePayload,
  state: db.ListSyncState
): { name: string; localWins: boolean } {
  if (!snapshot.name || snapshot.name === state.name) return { name: state.name, localWins: false };
  if (!state.dirty) return { name: snapshot.name, localWins: false };
  if (db.parseSyncTimestamp(snapshot.updatedAt) >= db.parseSyncTimestamp(state.updatedAt)) {
    return { name: snapshot.name, localWins: false };
  }
  return { name: state.name, localWins: true };
}

function handleTodoSnapshot(
  listId: number,
  key: string,
  conn: ShareConnection,
  snapshot: SharePayload
): void {
  const state = db.getListSyncState(listId);
  // The list may have been deleted or re-bound to a different share since
  // this connection was opened; a late frame must not cross shares.
  if (!state || state.shareKey !== key) return;
  // Drop stale replays (reordered or replayed during reconnects).
  if (snapshot.version < state.syncedVersion) return;

  const local = db.getTaskSyncRecords(listId);
  const remote = db.normalizeTaskItems(snapshot.items as unknown as db.SyncTaskItem[]);
  const merged = db.mergeRecords(local, remote, db.taskRecordKey);
  const mergedFp = db.taskFingerprint(merged);
  const { name, localWins: localNameWins } = resolveListName(snapshot, state);
  const remoteNameWins = !localNameWins && name !== state.name;

  const needPush = mergedFp !== db.taskFingerprint(remote) || localNameWins;
  if (mergedFp !== db.taskFingerprint(local) || remoteNameWins) {
    db.applySyncedTasks(listId, remoteNameWins ? name : '', merged, snapshot.version, !needPush);
    emitRemoteUpdate({ type: 'todo', listId });
  } else {
    db.adoptListSync(listId, snapshot.version, !needPush);
  }
  if (needPush) conn.send(name, toRemoteItems(merged), state.updatedAt);
}

/** Same flow as {@link handleTodoSnapshot}, for the shopping list (which has
 *  a fixed name, so only the records are merged). */
function handleShoppingSnapshot(key: string, conn: ShareConnection, snapshot: SharePayload): void {
  if (db.getSetting(db.SHOPPING_SHARE_KEY_SETTING) !== key) return;
  const state = db.getShoppingSyncState();
  if (snapshot.version < state.syncedVersion) return;

  const local = db.getShoppingSyncRecords();
  const remote = db.normalizeShoppingItems(snapshot.items as unknown as db.SyncShoppingItem[]);
  const merged = db.mergeRecords(local, remote, db.shoppingRecordKey);
  const mergedFp = db.shoppingFingerprint(merged);

  const needPush = mergedFp !== db.shoppingFingerprint(remote);
  if (mergedFp !== db.shoppingFingerprint(local)) {
    db.applySyncedShoppingItems(merged, snapshot.version, !needPush);
    emitRemoteUpdate({ type: 'shopping' });
  } else {
    db.adoptShoppingSync(snapshot.version, !needPush);
  }
  if (needPush) conn.send('Shopping', toRemoteItems(merged), state.updatedAt);
}

/** Bumped at the start of every refresh so an overlapping older call can
 *  detect it was superseded and stop before duplicating connections. */
let refreshGeneration = 0;

/**
 * (Re)opens a WebSocket connection for every list that currently has a share
 * key - every shared todo list plus the shopping list, if it's shared. Call
 * this on app start and any time sharing/joining/server settings change.
 */
export async function refreshSyncConnections(): Promise<void> {
  const generation = ++refreshGeneration;
  closeAll();
  const config = await getServerConfig();
  // A newer refresh started while we awaited; it owns the connection set.
  if (generation !== refreshGeneration) return;
  if (!config) return;

  for (const list of db.getLists()) {
    if (!list.shareKey) continue;
    const listId = list.id;
    const key = list.shareKey;
    const conn: ShareConnection = new ShareConnection(key, (snapshot) =>
      handleTodoSnapshot(listId, key, conn, snapshot)
    );
    connections.push({ kind: 'todo', listId, conn });
    conn.connect();
  }

  const shoppingKey = db.getSetting(db.SHOPPING_SHARE_KEY_SETTING);
  if (shoppingKey) {
    const conn: ShareConnection = new ShareConnection(shoppingKey, (snapshot) =>
      handleShoppingSnapshot(shoppingKey, conn, snapshot)
    );
    connections.push({ kind: 'shopping', conn });
    conn.connect();
  }
}

/** Call after any local edit to a todo list, so - if it's shared - the
 *  change goes out to peers immediately. Tombstones ride along so peers
 *  learn about deletions too. */
export function pushTodoListIfShared(listId: number): void {
  const state = db.getListSyncState(listId);
  if (!state?.shareKey) return;
  const managed = connections.find((c) => c.kind === 'todo' && c.listId === listId);
  managed?.conn.send(state.name, toRemoteItems(db.getTaskSyncRecords(listId)), state.updatedAt);
}

/** Call after any local edit to the shopping list, so - if it's shared - the
 *  change goes out to peers immediately. */
export function pushShoppingIfShared(): void {
  const key = db.getSetting(db.SHOPPING_SHARE_KEY_SETTING);
  if (!key) return;
  const managed = connections.find((c) => c.kind === 'shopping');
  managed?.conn.send(
    'Shopping',
    toRemoteItems(db.getShoppingSyncRecords()),
    db.getShoppingSyncState().updatedAt
  );
}

let started = false;

/** Starts the sync manager once, at app launch. */
export function startSyncManager(): void {
  if (started) return;
  started = true;
  refreshSyncConnections();
}
