import * as db from './db';
import { emitRemoteUpdate } from './remoteUpdates';
import { getServerConfig } from './serverConfig';
import { RemoteItem, ShareConnection, SharePayload } from './syncClient';

export const SHOPPING_SHARE_KEY_SETTING = 'shopping_share_key';

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

function toRemoteTaskItems(items: db.SyncTaskItem[]): RemoteItem[] {
  return items as unknown as RemoteItem[];
}

function toRemoteShoppingItems(items: db.SyncShoppingItem[]): RemoteItem[] {
  return items as unknown as RemoteItem[];
}

/**
 * Decides what to do with an incoming snapshot, using the server's
 * monotonically increasing version counter plus the local dirty flag
 * (set on every local edit, cleared when the server acknowledges our
 * content):
 *
 * - Frames older than the version we already adopted (reordered or replayed
 *   during reconnects) are dropped.
 * - A snapshot matching our content acknowledges it - typically the echo of
 *   our own push: adopt its version and clear the dirty flag.
 * - If we have no local edits, whatever the server holds is the truth -
 *   apply it.
 * - Same version and dirty: the server has nothing we haven't seen, so our
 *   unacknowledged edits (e.g. made offline) win - push them.
 * - Newer version AND dirty: a genuine concurrent conflict. The server's
 *   replace-wholesale model forces one side to lose, so the freshest edit
 *   wins. Both timestamps are device edit times (the remote one is relayed
 *   by the server from the editing peer), so the comparison never crosses
 *   into the server's clock domain.
 */
function arbitrate(
  snapshot: SharePayload,
  local: db.SyncState,
  sameContent: boolean,
  apply: () => void,
  push: () => void
): void {
  if (snapshot.version < local.syncedVersion) return;
  if (sameContent) {
    apply();
    return;
  }
  if (!local.dirty) {
    apply();
    return;
  }
  if (snapshot.version === local.syncedVersion) {
    push();
    return;
  }
  if (db.parseSyncTimestamp(snapshot.updatedAt) >= db.parseSyncTimestamp(local.updatedAt)) {
    apply();
  } else {
    push();
  }
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
  // Drop stale replays before the full-table read and fingerprinting below.
  if (snapshot.version < state.syncedVersion) return;
  const localItems = db.getTasksAsSyncItems(listId);
  const remoteItems = snapshot.items as unknown as db.SyncTaskItem[];
  const sameContent =
    (!snapshot.name || snapshot.name === state.name) &&
    db.taskFingerprint(remoteItems) === db.taskFingerprint(localItems);
  arbitrate(
    snapshot,
    state,
    sameContent,
    () => {
      db.applySyncedTasks(listId, snapshot.name, remoteItems, snapshot.version);
      emitRemoteUpdate({ type: 'todo', listId });
    },
    () => conn.send(state.name, toRemoteTaskItems(localItems), state.updatedAt)
  );
}

/** Same flow as {@link handleTodoSnapshot}, for the shopping list. */
function handleShoppingSnapshot(key: string, conn: ShareConnection, snapshot: SharePayload): void {
  if (db.getSetting(SHOPPING_SHARE_KEY_SETTING) !== key) return;
  const state = db.getShoppingSyncState();
  if (snapshot.version < state.syncedVersion) return;
  const localItems = db.getShoppingItemsAsSyncItems();
  const remoteItems = snapshot.items as unknown as db.SyncShoppingItem[];
  const sameContent = db.shoppingFingerprint(remoteItems) === db.shoppingFingerprint(localItems);
  arbitrate(
    snapshot,
    state,
    sameContent,
    () => {
      db.applySyncedShoppingItems(remoteItems, snapshot.version);
      emitRemoteUpdate({ type: 'shopping' });
    },
    () => conn.send('Shopping', toRemoteShoppingItems(localItems), state.updatedAt)
  );
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

  const shoppingKey = db.getSetting(SHOPPING_SHARE_KEY_SETTING);
  if (shoppingKey) {
    const conn: ShareConnection = new ShareConnection(shoppingKey, (snapshot) =>
      handleShoppingSnapshot(shoppingKey, conn, snapshot)
    );
    connections.push({ kind: 'shopping', conn });
    conn.connect();
  }
}

/** Call after any local edit to a todo list, so - if it's shared - the
 *  change goes out to peers immediately. */
export function pushTodoListIfShared(listId: number): void {
  const state = db.getListSyncState(listId);
  if (!state?.shareKey) return;
  const managed = connections.find((c) => c.kind === 'todo' && c.listId === listId);
  managed?.conn.send(state.name, toRemoteTaskItems(db.getTasksAsSyncItems(listId)), state.updatedAt);
}

/** Call after any local edit to the shopping list, so - if it's shared - the
 *  change goes out to peers immediately. */
export function pushShoppingIfShared(): void {
  const key = db.getSetting(SHOPPING_SHARE_KEY_SETTING);
  if (!key) return;
  const managed = connections.find((c) => c.kind === 'shopping');
  managed?.conn.send(
    'Shopping',
    toRemoteShoppingItems(db.getShoppingItemsAsSyncItems()),
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
