import * as db from './db';
import { emitRemoteUpdate } from './remoteUpdates';
import { getServerConfig } from './serverConfig';
import { RemoteItem, ShareConnection } from './syncClient';

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
 * (Re)opens a WebSocket connection for every list that currently has a share
 * key - every shared todo list plus the shopping list, if it's shared. Call
 * this on app start and any time sharing/joining/server settings change.
 */
export async function refreshSyncConnections(): Promise<void> {
  closeAll();
  const config = await getServerConfig();
  if (!config) return;

  for (const list of db.getLists()) {
    if (!list.shareKey) continue;
    const conn = new ShareConnection(list.shareKey, (snapshot) => {
      db.applySyncedTasks(list.id, snapshot.items as unknown as db.SyncTaskItem[]);
      emitRemoteUpdate({ type: 'todo', listId: list.id });
    });
    connections.push({ kind: 'todo', listId: list.id, conn });
    conn.connect();
  }

  const shoppingKey = db.getSetting(SHOPPING_SHARE_KEY_SETTING);
  if (shoppingKey) {
    const conn = new ShareConnection(shoppingKey, (snapshot) => {
      db.applySyncedShoppingItems(snapshot.items as unknown as db.SyncShoppingItem[]);
      emitRemoteUpdate({ type: 'shopping' });
    });
    connections.push({ kind: 'shopping', conn });
    conn.connect();
  }
}

/** Call after any local edit to a todo list, so - if it's shared - the
 *  change goes out to peers immediately. */
export function pushTodoListIfShared(listId: number): void {
  const list = db.getLists().find((l) => l.id === listId);
  if (!list?.shareKey) return;
  const managed = connections.find((c) => c.kind === 'todo' && c.listId === listId);
  managed?.conn.send(list.name, toRemoteTaskItems(db.getTasksAsSyncItems(listId)));
}

/** Call after any local edit to the shopping list, so - if it's shared - the
 *  change goes out to peers immediately. */
export function pushShoppingIfShared(): void {
  const key = db.getSetting(SHOPPING_SHARE_KEY_SETTING);
  if (!key) return;
  const managed = connections.find((c) => c.kind === 'shopping');
  managed?.conn.send('Shopping', toRemoteShoppingItems(db.getShoppingItemsAsSyncItems()));
}

let started = false;

/** Starts the sync manager once, at app launch. */
export function startSyncManager(): void {
  if (started) return;
  started = true;
  refreshSyncConnections();
}
