import * as db from './db';
import { emitRemoteUpdate } from './remoteUpdates';
import { fetchShare } from './syncClient';
import { refreshSyncConnections } from './syncManager';

export interface JoinResult {
  kind: 'todo' | 'shopping';
  listId: number;
}

/**
 * Fetches a share key and joins it on whichever side it belongs to - a todo
 * key becomes a todo list, a shopping key becomes a shopping list - no matter
 * which section's Join dialog the user typed it into. Returns where it went
 * so the caller can either select the new list or point the user at the
 * other section.
 *
 * Rejoining a share this device already has (e.g. retrying after a partial
 * failure) must neither create a duplicate list nor force-apply the snapshot
 * over local edits the live sync path hasn't pushed yet - the reopened
 * connection arbitrates content properly.
 */
export async function joinShareByKey(key: string): Promise<JoinResult> {
  const snapshot = await fetchShare(key);
  let targetId: number;
  if (snapshot.kind === 'todo') {
    const existing = db.getLists().find((l) => l.shareKey === key);
    if (existing) {
      targetId = existing.id;
    } else {
      const name = snapshot.name || 'Shared List';
      const created = db.createJoinedList(name, key);
      db.applySyncedTasks(
        created.id,
        name,
        snapshot.items as unknown as db.SyncTaskItem[],
        snapshot.version
      );
      targetId = created.id;
    }
  } else {
    const existing = db.getShoppingLists().find((l) => l.shareKey === key);
    if (existing) {
      targetId = existing.id;
    } else {
      const name = snapshot.name || 'Shared List';
      const created = db.createJoinedShoppingList(name, key);
      db.applySyncedShoppingItems(
        created.id,
        name,
        snapshot.items as unknown as db.SyncShoppingItem[],
        snapshot.version
      );
      targetId = created.id;
    }
  }
  await refreshSyncConnections();
  // A join applies a remote snapshot, so the refresh bus is the right way
  // to tell whichever section is currently on screen that its list set
  // changed - joins can arrive from the other section's dialog, a deep
  // link, or a QR scan, none of which the visible section knows about.
  emitRemoteUpdate({ type: snapshot.kind, listId: targetId });
  return { kind: snapshot.kind, listId: targetId };
}
