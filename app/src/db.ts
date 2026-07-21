import * as SQLite from 'expo-sqlite';
import { SEED_FOOD_ITEMS } from './foodItems';
import {
  normalizeShoppingItems,
  normalizeTaskItems,
  parseSyncTimestamp,
  SyncShoppingItem,
  SyncTaskItem,
} from './syncCore';
import { DictionaryEntry, ShoppingItem, Task, TodoList } from './types';
import { generateUuid } from './uuid';

// The pure protocol pieces (item shapes, fingerprints, merge) live in
// syncCore so the test harness can import them without expo; re-exported
// here so the rest of the app keeps a single sync entry point.
export * from './syncCore';

const db = SQLite.openDatabaseSync('jodoo.db');



export function initDb(): void {
  db.execSync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS lists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      share_key TEXT,
      synced_version INTEGER NOT NULL DEFAULT 0,
      dirty INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      list_id INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
      uuid TEXT,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      due_date TEXT,
      color_index INTEGER NOT NULL DEFAULT 0,
      done INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      position INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS shopping_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT,
      name TEXT NOT NULL,
      checked INTEGER NOT NULL DEFAULT 0,
      position INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT '',
      amount TEXT
    );
    CREATE TABLE IF NOT EXISTS dictionary (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      name_lower TEXT NOT NULL UNIQUE,
      uses INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sync_deletions (
      scope TEXT NOT NULL,
      uuid TEXT NOT NULL,
      deleted_at TEXT NOT NULL,
      PRIMARY KEY (scope, uuid)
    );
  `);

  // Migration: shopping_items.amount was added after initial release, so
  // CREATE TABLE IF NOT EXISTS above won't add it to existing databases.
  const shoppingCols = db.getAllSync<{ name: string }>('PRAGMA table_info(shopping_items)');
  if (!shoppingCols.some((c) => c.name === 'amount')) {
    db.execSync('ALTER TABLE shopping_items ADD COLUMN amount TEXT');
  }

  // Start the user off with one list so the To Do section is never empty.
  const row = db.getFirstSync<{ n: number }>('SELECT COUNT(*) AS n FROM lists');
  if (!row || row.n === 0) {
    createList();
  }
  // Seed the autocomplete dictionary once; after that users own it.
  const dict = db.getFirstSync<{ n: number }>('SELECT COUNT(*) AS n FROM dictionary');
  if (!dict || dict.n === 0) {
    db.withTransactionSync(() => {
      for (const item of SEED_FOOD_ITEMS) {
        db.runSync(
          'INSERT OR IGNORE INTO dictionary (name, name_lower) VALUES (?, ?)',
          item,
          item.toLowerCase()
        );
      }
    });
  }
}

// ---------- Settings (simple key/value config, e.g. the shopping share key) ----------

export function getSetting(key: string): string | null {
  const row = db.getFirstSync<{ value: string }>('SELECT value FROM settings WHERE key = ?', key);
  return row ? row.value : null;
}

export function setSetting(key: string, value: string): void {
  db.runSync(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    key,
    value
  );
}

export function deleteSetting(key: string): void {
  db.runSync('DELETE FROM settings WHERE key = ?', key);
}

// ---------- Sync state ----------
//
// Shared lists are reconciled item by item: every item carries its own edit
// timestamp, and the newer edit of any single item wins, so non-conflicting
// changes from different devices all survive a merge. Deletions are kept as
// tombstones (uuid + deletion time) so a deleted item is distinguishable
// from one a peer has not seen yet - without them, every merge would
// resurrect deleted items. The server's monotonically increasing version
// counter still orders snapshots; the per-list dirty flag and edit time now
// arbitrate only the list *name*, which has no per-item timestamp.

export const SHOPPING_SHARE_KEY_SETTING = 'shopping_share_key';

/** Tombstone scope for a todo list's deletions. */
function listScope(listId: number): string {
  return `list:${listId}`;
}

const SHOPPING_SCOPE = 'shopping';

/** How long deletion tombstones are kept before being purged. A device that
 *  stays offline longer than this may resurrect items deleted by its peers. */
const TOMBSTONE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** Records "item `uuid` was just deleted from `scope`", so the deletion
 *  propagates through merges instead of being undone by them. */
function addTombstone(scope: string, uuid: string | null | undefined): void {
  if (!uuid) return;
  db.runSync(
    'INSERT INTO sync_deletions (scope, uuid, deleted_at) VALUES (?, ?, ?) ON CONFLICT(scope, uuid) DO UPDATE SET deleted_at = excluded.deleted_at',
    scope,
    uuid,
    new Date().toISOString()
  );
}

interface TombstoneRow {
  uuid: string;
  deleted_at: string;
}

/** Live tombstones for a scope, oldest ones purged first. */
function getTombstones(scope: string): TombstoneRow[] {
  const cutoff = Date.now() - TOMBSTONE_RETENTION_MS;
  const rows = db.getAllSync<TombstoneRow>(
    'SELECT uuid, deleted_at FROM sync_deletions WHERE scope = ? ORDER BY uuid',
    scope
  );
  const expired = rows.filter((r) => parseSyncTimestamp(r.deleted_at) < cutoff);
  for (const r of expired) {
    db.runSync('DELETE FROM sync_deletions WHERE scope = ? AND uuid = ?', scope, r.uuid);
  }
  return rows.filter((r) => parseSyncTimestamp(r.deleted_at) >= cutoff);
}

/** Sync-arbitration state shared by todo lists and the shopping list.
 *  `updatedAt` is the wall-clock time of the last local edit and is only
 *  meaningful while `dirty`. */
export interface SyncState {
  syncedVersion: number;
  dirty: boolean;
  updatedAt: string;
}

/** {@link SyncState} plus the list fields the arbitration handlers need. */
export interface ListSyncState extends SyncState {
  name: string;
  shareKey: string | null;
}

export function getListSyncState(listId: number): ListSyncState | null {
  const row = db.getFirstSync<{
    name: string;
    share_key: string | null;
    synced_version: number;
    dirty: number;
    updated_at: string;
  }>('SELECT name, share_key, synced_version, dirty, updated_at FROM lists WHERE id = ?', listId);
  if (!row) return null;
  return {
    name: row.name,
    shareKey: row.share_key,
    syncedVersion: row.synced_version,
    dirty: row.dirty === 1,
    updatedAt: row.updated_at,
  };
}

/** Records "this list's content just changed locally". */
function markListDirty(listId: number): void {
  db.runSync(
    'UPDATE lists SET dirty = 1, updated_at = ? WHERE id = ?',
    new Date().toISOString(),
    listId
  );
}

/** Like {@link markListDirty}, looked up via one of the list's tasks; must
 *  be called while the task row still exists. */
function markListOfTaskDirty(taskId: number): void {
  db.runSync(
    'UPDATE lists SET dirty = 1, updated_at = ? WHERE id = (SELECT list_id FROM tasks WHERE id = ?)',
    new Date().toISOString(),
    taskId
  );
}

const SHOPPING_SYNCED_VERSION_SETTING = 'shopping_synced_version';
const SHOPPING_DIRTY_SETTING = 'shopping_dirty';
const SHOPPING_UPDATED_AT_SETTING = 'shopping_updated_at';

export function getShoppingSyncState(): SyncState {
  return {
    // `|| 0` also shields against a corrupted non-numeric setting (NaN).
    syncedVersion: Number(getSetting(SHOPPING_SYNCED_VERSION_SETTING) ?? 0) || 0,
    dirty: getSetting(SHOPPING_DIRTY_SETTING) === '1',
    updatedAt: getSetting(SHOPPING_UPDATED_AT_SETTING) ?? '',
  };
}

function markShoppingDirty(): void {
  db.runSync(
    'INSERT INTO settings (key, value) VALUES (?, ?), (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    SHOPPING_DIRTY_SETTING,
    '1',
    SHOPPING_UPDATED_AT_SETTING,
    new Date().toISOString()
  );
}

/** Records the shopping list's server binding right after creating the
 *  share: the server was seeded with our current items, so its version is
 *  adopted as clean - otherwise the first incoming snapshot would be
 *  arbitrated as a conflict against pre-share dirty state. */
export function bindShoppingShare(version: number): void {
  setSetting(SHOPPING_SYNCED_VERSION_SETTING, String(version));
  setSetting(SHOPPING_DIRTY_SETTING, '0');
}


// ---------- Lists ----------

interface ListRow {
  id: number;
  name: string;
  position: number;
  share_key: string | null;
}

function toTodoList(r: ListRow): TodoList {
  return { id: r.id, name: r.name, position: r.position, shareKey: r.share_key };
}

export function getLists(): TodoList[] {
  return db.getAllSync<ListRow>('SELECT * FROM lists ORDER BY position, id').map(toTodoList);
}

/**
 * Default tab names are "To Do N" where N is the smallest positive integer
 * that does not collide with any existing tab name.
 */
export function nextDefaultListName(): string {
  const names = new Set(getLists().map((l) => l.name));
  let n = 1;
  while (names.has(`To Do ${n}`)) n++;
  return `To Do ${n}`;
}

export function createList(): TodoList {
  const name = nextDefaultListName();
  const pos = db.getFirstSync<{ p: number }>(
    'SELECT COALESCE(MAX(position), 0) + 1 AS p FROM lists'
  )!.p;
  const res = db.runSync('INSERT INTO lists (name, position) VALUES (?, ?)', name, pos);
  return { id: Number(res.lastInsertRowId), name, position: pos, shareKey: null };
}

/** Creates a new list that is already bound to a server share (used when
 *  joining another user's shared todo list via its secret key). */
export function createJoinedList(name: string, shareKey: string): TodoList {
  const pos = db.getFirstSync<{ p: number }>(
    'SELECT COALESCE(MAX(position), 0) + 1 AS p FROM lists'
  )!.p;
  // synced_version starts at 0 and dirty at 0, so the share's first
  // incoming snapshot (version >= 1) always applies.
  const res = db.runSync(
    'INSERT INTO lists (name, position, share_key) VALUES (?, ?, ?)',
    name,
    pos,
    shareKey
  );
  return { id: Number(res.lastInsertRowId), name, position: pos, shareKey };
}

/** Marks an existing list as shared once the owner has generated a key for
 *  it. The server share was seeded with this list's current content, so its
 *  version is adopted and the list starts clean - and any stale sync state
 *  from a previous binding is overwritten. */
export function setListShareKey(id: number, shareKey: string, syncedVersion: number): void {
  db.runSync(
    'UPDATE lists SET share_key = ?, synced_version = ?, dirty = 0 WHERE id = ?',
    shareKey,
    syncedVersion,
    id
  );
}

/** Detaches a list from its share: the list and its tasks stay on this
 *  device but stop syncing. The share itself (and every other user's copy)
 *  is untouched; local sync state and tombstones are discarded. */
export function detachList(id: number): void {
  db.runSync(
    "UPDATE lists SET share_key = NULL, synced_version = 0, dirty = 0, updated_at = '' WHERE id = ?",
    id
  );
  db.runSync('DELETE FROM sync_deletions WHERE scope = ?', listScope(id));
}

export function renameList(id: number, name: string): void {
  db.runSync('UPDATE lists SET name = ? WHERE id = ?', name.trim(), id);
  markListDirty(id);
}

/** Persists a new list order (used by drag-to-reorder tabs in the UI). */
export function reorderLists(orderedIds: number[]): void {
  db.withTransactionSync(() => {
    orderedIds.forEach((id, index) => {
      db.runSync('UPDATE lists SET position = ? WHERE id = ?', index, id);
    });
  });
}

export function deleteList(id: number): void {
  db.runSync('DELETE FROM tasks WHERE list_id = ?', id);
  db.runSync('DELETE FROM sync_deletions WHERE scope = ?', listScope(id));
  db.runSync('DELETE FROM lists WHERE id = ?', id);
}

/** Deletes every todo list (tasks, sync state, and share bindings included),
 *  then recreates the single default list so the To Do section is never
 *  empty. Only this device is reset - shared copies on the server and on
 *  peers' devices are untouched. */
export function deleteAllLists(): TodoList {
  db.withTransactionSync(() => {
    db.runSync('DELETE FROM tasks');
    db.runSync("DELETE FROM sync_deletions WHERE scope LIKE 'list:%'");
    db.runSync('DELETE FROM lists');
  });
  return createList();
}

// ---------- Tasks ----------

interface TaskRow {
  id: number;
  list_id: number;
  uuid: string;
  title: string;
  description: string;
  due_date: string | null;
  color_index: number;
  done: number;
  created_at: string;
  position: number;
}

function toTask(r: TaskRow): Task {
  return {
    id: r.id,
    listId: r.list_id,
    uuid: r.uuid,
    title: r.title,
    description: r.description,
    dueDate: r.due_date,
    colorIndex: r.color_index,
    done: r.done === 1,
    createdAt: r.created_at,
  };
}

export function getTasks(listId: number): Task[] {
  return db
    .getAllSync<TaskRow>(
      'SELECT * FROM tasks WHERE list_id = ? ORDER BY done, position, id',
      listId
    )
    .map(toTask);
}

export const MAX_TASK_TITLE_LENGTH = 100;
export const MAX_TASK_DESCRIPTION_LENGTH = 1000;

export function createTask(
  listId: number,
  title: string,
  description: string,
  dueDate: string | null
): void {
  // Auto-assign the next pastel in rotation, per list.
  const colorIndex = db.getFirstSync<{ n: number }>(
    'SELECT COUNT(*) AS n FROM tasks WHERE list_id = ?',
    listId
  )!.n % 8;
  const position = db.getFirstSync<{ p: number }>(
    'SELECT COALESCE(MAX(position), -1) + 1 AS p FROM tasks WHERE list_id = ?',
    listId
  )!.p;
  db.runSync(
    'INSERT INTO tasks (list_id, uuid, title, description, due_date, color_index, position, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    listId,
    generateUuid(),
    title.trim().slice(0, MAX_TASK_TITLE_LENGTH),
    description.trim().slice(0, MAX_TASK_DESCRIPTION_LENGTH),
    dueDate,
    colorIndex,
    position,
    new Date().toISOString()
  );
  markListDirty(listId);
}

export function updateTask(
  id: number,
  title: string,
  description: string,
  dueDate: string | null
): void {
  db.runSync(
    'UPDATE tasks SET title = ?, description = ?, due_date = ?, updated_at = ? WHERE id = ?',
    title.trim().slice(0, MAX_TASK_TITLE_LENGTH),
    description.trim().slice(0, MAX_TASK_DESCRIPTION_LENGTH),
    dueDate,
    new Date().toISOString(),
    id
  );
  markListOfTaskDirty(id);
}

export function setTaskDone(id: number, done: boolean): void {
  db.runSync(
    'UPDATE tasks SET done = ?, updated_at = ? WHERE id = ?',
    done ? 1 : 0,
    new Date().toISOString(),
    id
  );
  markListOfTaskDirty(id);
}

/** Tombstones a task that is about to leave its current list (deletion or
 *  move), but only when that list is shared - unshared lists never merge, so
 *  their tombstones would just accumulate. Must run while the row exists. */
function tombstoneTaskIfShared(taskId: number): void {
  const row = db.getFirstSync<{ uuid: string; list_id: number; share_key: string | null }>(
    'SELECT t.uuid, t.list_id, l.share_key FROM tasks t JOIN lists l ON l.id = t.list_id WHERE t.id = ?',
    taskId
  );
  if (row?.share_key) addTombstone(listScope(row.list_id), row.uuid);
}

/** Moves a task to a different list (used by drag-and-drop in the UI); it is
 *  appended to the end of the destination list. */
export function moveTaskToList(id: number, newListId: number): void {
  // Mark the source list while the task still points at it; to that list's
  // share this is a deletion, so it also needs a tombstone.
  markListOfTaskDirty(id);
  tombstoneTaskIfShared(id);
  const position = db.getFirstSync<{ p: number }>(
    'SELECT COALESCE(MAX(position), -1) + 1 AS p FROM tasks WHERE list_id = ?',
    newListId
  )!.p;
  db.runSync(
    'UPDATE tasks SET list_id = ?, position = ?, updated_at = ? WHERE id = ?',
    newListId,
    position,
    new Date().toISOString(),
    id
  );
  // If this task once lived in (and was tombstoned out of) the destination
  // list, its return must not be undone by the old tombstone.
  const uuid = db.getFirstSync<{ uuid: string }>('SELECT uuid FROM tasks WHERE id = ?', id)?.uuid;
  if (uuid) {
    db.runSync(
      'DELETE FROM sync_deletions WHERE scope = ? AND uuid = ?',
      listScope(newListId),
      uuid
    );
  }
  markListDirty(newListId);
}

/** Persists a new task order within a list (used by drag-to-reorder in the UI). */
export function reorderTasks(listId: number, orderedIds: number[]): void {
  const now = new Date().toISOString();
  db.withTransactionSync(() => {
    orderedIds.forEach((id, index) => {
      // Only touch rows whose position actually changes, so a reorder doesn't
      // make every task look freshly edited to the sync merge.
      db.runSync(
        'UPDATE tasks SET position = ?, updated_at = ? WHERE id = ? AND list_id = ? AND position <> ?',
        index,
        now,
        id,
        listId,
        index
      );
    });
  });
  markListDirty(listId);
}

export function deleteTask(id: number): void {
  // Mark first: the list lookup needs the task row to still exist.
  markListOfTaskDirty(id);
  tombstoneTaskIfShared(id);
  db.runSync('DELETE FROM tasks WHERE id = ?', id);
}

// ---------- Sync: todo list snapshot export/apply ----------

/** The list's full sync record set: live tasks in display order followed by
 *  deletion tombstones (uuid-sorted). This is what gets pushed to the server
 *  and merged against incoming snapshots. */
export function getTaskSyncRecords(listId: number): SyncTaskItem[] {
  // Canonical (position, uuid) order - the same order mergeRecords emits -
  // so an unchanged list fingerprints identically to its own merge result.
  const live: SyncTaskItem[] = db
    .getAllSync<TaskRow & { updated_at: string }>(
      'SELECT * FROM tasks WHERE list_id = ? ORDER BY position, uuid',
      listId
    )
    .map((r) => ({
      uuid: r.uuid,
      title: r.title,
      description: r.description,
      dueDate: r.due_date,
      colorIndex: r.color_index,
      done: r.done === 1,
      position: r.position,
      updatedAt: r.updated_at,
    }));
  const tombstones: SyncTaskItem[] = getTombstones(listScope(listId)).map((t) => ({
    uuid: t.uuid,
    title: '',
    description: '',
    dueDate: null,
    colorIndex: 0,
    done: false,
    position: 0,
    updatedAt: t.deleted_at,
    deleted: true,
  }));
  return [...live, ...tombstones];
}

/**
 * Writes a merged record set back to a list: live records are upserted by
 * `uuid` (position and edit time included), tombstoned records delete any
 * matching local task and are remembered in `sync_deletions` so the deletion
 * survives future merges. Adopts the snapshot's server version (never moving
 * backwards); `clearDirty` is false when the caller is about to push local
 * changes the server hasn't acknowledged yet. An empty `name` keeps the
 * current list name.
 */
export function applySyncedTasks(
  listId: number,
  name: string,
  items: SyncTaskItem[],
  version: number,
  clearDirty = true
): void {
  const scope = listScope(listId);
  db.withTransactionSync(() => {
    db.runSync(
      "UPDATE lists SET name = COALESCE(NULLIF(?, ''), name), synced_version = MAX(synced_version, ?), dirty = CASE WHEN ? THEN 0 ELSE dirty END WHERE id = ?",
      name,
      version,
      clearDirty ? 1 : 0,
      listId
    );
    const existing = db.getAllSync<{ id: number; uuid: string }>(
      'SELECT id, uuid FROM tasks WHERE list_id = ?',
      listId
    );
    const byUuid = new Map(existing.map((e) => [e.uuid, e.id]));
    const seen = new Set<string>();
    for (const item of normalizeTaskItems(items)) {
      seen.add(item.uuid);
      const existingId = byUuid.get(item.uuid);
      if (item.deleted) {
        if (existingId != null) db.runSync('DELETE FROM tasks WHERE id = ?', existingId);
        db.runSync(
          'INSERT INTO sync_deletions (scope, uuid, deleted_at) VALUES (?, ?, ?) ON CONFLICT(scope, uuid) DO UPDATE SET deleted_at = excluded.deleted_at',
          scope,
          item.uuid,
          item.updatedAt || new Date().toISOString()
        );
        continue;
      }
      if (existingId != null) {
        db.runSync(
          'UPDATE tasks SET title = ?, description = ?, due_date = ?, color_index = ?, done = ?, position = ?, updated_at = ? WHERE id = ?',
          item.title,
          item.description,
          item.dueDate,
          item.colorIndex,
          item.done ? 1 : 0,
          item.position,
          item.updatedAt,
          existingId
        );
      } else {
        db.runSync(
          'INSERT INTO tasks (list_id, uuid, title, description, due_date, color_index, done, position, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          listId,
          item.uuid,
          item.title,
          item.description,
          item.dueDate,
          item.colorIndex,
          item.done ? 1 : 0,
          item.position,
          item.updatedAt
        );
      }
      // The item exists again (or still); a stale tombstone must not linger.
      db.runSync('DELETE FROM sync_deletions WHERE scope = ? AND uuid = ?', scope, item.uuid);
    }
    // Safety net: local rows the record set doesn't mention at all.
    for (const e of existing) {
      if (!seen.has(e.uuid)) {
        db.runSync('DELETE FROM tasks WHERE id = ?', e.id);
      }
    }
  });
}

/** Records that a snapshot at `version` was seen and fully reconciled
 *  without needing any local writes; still clears the dirty flag unless the
 *  caller has local changes left to push. */
export function adoptListSync(listId: number, version: number, clearDirty: boolean): void {
  db.runSync(
    'UPDATE lists SET synced_version = MAX(synced_version, ?), dirty = CASE WHEN ? THEN 0 ELSE dirty END WHERE id = ?',
    version,
    clearDirty ? 1 : 0,
    listId
  );
}

// ---------- Shopping ----------

interface ShoppingRow {
  id: number;
  uuid: string;
  name: string;
  checked: number;
  position: number;
  amount: string | null;
}

export function getShoppingItems(): ShoppingItem[] {
  return db
    .getAllSync<ShoppingRow>('SELECT * FROM shopping_items ORDER BY checked, position, id')
    .map((r) => ({
      id: r.id,
      uuid: r.uuid,
      name: r.name,
      checked: r.checked === 1,
      position: r.position,
      amount: r.amount,
    }));
}

/** Shopping item names are kept short enough to read on one line. */
export const MAX_SHOPPING_ITEM_NAME_LENGTH = 32;

export function addShoppingItem(name: string): void {
  const pos = db.getFirstSync<{ p: number }>(
    'SELECT COALESCE(MAX(position), 0) + 1 AS p FROM shopping_items'
  )!.p;
  db.runSync(
    'INSERT INTO shopping_items (name, uuid, position, updated_at) VALUES (?, ?, ?, ?)',
    name.trim().slice(0, MAX_SHOPPING_ITEM_NAME_LENGTH),
    generateUuid(),
    pos,
    new Date().toISOString()
  );
  markShoppingDirty();
}

export function setShoppingChecked(id: number, checked: boolean): void {
  db.runSync(
    'UPDATE shopping_items SET checked = ?, updated_at = ? WHERE id = ?',
    checked ? 1 : 0,
    new Date().toISOString(),
    id
  );
  markShoppingDirty();
}

/** Sets or clears (via null/empty) a shopping item's free-form amount. */
export function setShoppingAmount(id: number, amount: string | null): void {
  db.runSync(
    'UPDATE shopping_items SET amount = ?, updated_at = ? WHERE id = ?',
    amount && amount.trim() ? amount.trim() : null,
    new Date().toISOString(),
    id
  );
  markShoppingDirty();
}

/** Tombstones shopping items about to be deleted, but only while the
 *  shopping list is shared (unshared lists never merge). */
function tombstoneShoppingItems(ids: number[]): void {
  if (!getSetting(SHOPPING_SHARE_KEY_SETTING)) return;
  for (const id of ids) {
    const row = db.getFirstSync<{ uuid: string }>(
      'SELECT uuid FROM shopping_items WHERE id = ?',
      id
    );
    addTombstone(SHOPPING_SCOPE, row?.uuid);
  }
}

export function deleteShoppingItem(id: number): void {
  tombstoneShoppingItems([id]);
  db.runSync('DELETE FROM shopping_items WHERE id = ?', id);
  markShoppingDirty();
}

export function clearCheckedShoppingItems(): void {
  const checked = db.getAllSync<{ id: number }>('SELECT id FROM shopping_items WHERE checked = 1');
  tombstoneShoppingItems(checked.map((r) => r.id));
  db.runSync('DELETE FROM shopping_items WHERE checked = 1');
  markShoppingDirty();
}

// ---------- Sync: shopping list snapshot export/apply ----------

/** Shopping counterpart of {@link getTaskSyncRecords}. */
export function getShoppingSyncRecords(): SyncShoppingItem[] {
  // Canonical (position, uuid) order, mirroring getTaskSyncRecords.
  const live: SyncShoppingItem[] = db
    .getAllSync<ShoppingRow & { updated_at: string }>(
      'SELECT * FROM shopping_items ORDER BY position, uuid'
    )
    .map((r) => ({
      uuid: r.uuid,
      name: r.name,
      checked: r.checked === 1,
      position: r.position,
      updatedAt: r.updated_at,
      amount: r.amount,
    }));
  const tombstones: SyncShoppingItem[] = getTombstones(SHOPPING_SCOPE).map((t) => ({
    uuid: t.uuid,
    name: '',
    checked: false,
    position: 0,
    updatedAt: t.deleted_at,
    amount: null,
    deleted: true,
  }));
  return [...live, ...tombstones];
}

/** Same reconciliation strategy as {@link applySyncedTasks}, for the single
 *  shopping list. */
export function applySyncedShoppingItems(
  items: SyncShoppingItem[],
  version: number,
  clearDirty = true
): void {
  db.withTransactionSync(() => {
    const current = Number(getSetting(SHOPPING_SYNCED_VERSION_SETTING) ?? 0);
    setSetting(SHOPPING_SYNCED_VERSION_SETTING, String(Math.max(current, version)));
    if (clearDirty) setSetting(SHOPPING_DIRTY_SETTING, '0');
    const existing = db.getAllSync<{ id: number; uuid: string }>(
      'SELECT id, uuid FROM shopping_items'
    );
    const byUuid = new Map(existing.map((e) => [e.uuid, e.id]));
    const seen = new Set<string>();
    for (const item of normalizeShoppingItems(items)) {
      seen.add(item.uuid);
      const existingId = byUuid.get(item.uuid);
      if (item.deleted) {
        if (existingId != null) db.runSync('DELETE FROM shopping_items WHERE id = ?', existingId);
        db.runSync(
          'INSERT INTO sync_deletions (scope, uuid, deleted_at) VALUES (?, ?, ?) ON CONFLICT(scope, uuid) DO UPDATE SET deleted_at = excluded.deleted_at',
          SHOPPING_SCOPE,
          item.uuid,
          item.updatedAt || new Date().toISOString()
        );
        continue;
      }
      if (existingId != null) {
        db.runSync(
          'UPDATE shopping_items SET name = ?, checked = ?, position = ?, updated_at = ?, amount = ? WHERE id = ?',
          item.name,
          item.checked ? 1 : 0,
          item.position,
          item.updatedAt,
          item.amount ?? null,
          existingId
        );
      } else {
        db.runSync(
          'INSERT INTO shopping_items (name, uuid, checked, position, updated_at, amount) VALUES (?, ?, ?, ?, ?, ?)',
          item.name,
          item.uuid,
          item.checked ? 1 : 0,
          item.position,
          item.updatedAt,
          item.amount ?? null
        );
      }
      db.runSync(
        'DELETE FROM sync_deletions WHERE scope = ? AND uuid = ?',
        SHOPPING_SCOPE,
        item.uuid
      );
    }
    for (const e of existing) {
      if (!seen.has(e.uuid)) {
        db.runSync('DELETE FROM shopping_items WHERE id = ?', e.id);
      }
    }
  });
}

/** Shopping counterpart of {@link adoptListSync}. */
export function adoptShoppingSync(version: number, clearDirty: boolean): void {
  const current = Number(getSetting(SHOPPING_SYNCED_VERSION_SETTING) ?? 0);
  setSetting(SHOPPING_SYNCED_VERSION_SETTING, String(Math.max(current, version)));
  if (clearDirty) setSetting(SHOPPING_DIRTY_SETTING, '0');
}

/** Deletes every local shopping item; used right before adopting someone
 *  else's shared shopping list via its key. Resets the sync state (including
 *  tombstones from the previous binding) so the new share's first snapshot
 *  always applies cleanly. */
export function clearAllShoppingItems(): void {
  db.runSync('DELETE FROM shopping_items');
  db.runSync('DELETE FROM sync_deletions WHERE scope = ?', SHOPPING_SCOPE);
  deleteSetting(SHOPPING_SYNCED_VERSION_SETTING);
  deleteSetting(SHOPPING_DIRTY_SETTING);
  deleteSetting(SHOPPING_UPDATED_AT_SETTING);
}

/** Shopping counterpart of {@link detachList}: keeps the items on this
 *  device but stops syncing them; the share and other users are untouched. */
export function detachShoppingShare(): void {
  deleteSetting(SHOPPING_SHARE_KEY_SETTING);
  db.runSync('DELETE FROM sync_deletions WHERE scope = ?', SHOPPING_SCOPE);
  deleteSetting(SHOPPING_SYNCED_VERSION_SETTING);
  deleteSetting(SHOPPING_DIRTY_SETTING);
  deleteSetting(SHOPPING_UPDATED_AT_SETTING);
}

/** Device-local reset of the whole shopping side: detaches from any share,
 *  deletes every item and all sync state, and restores the default
 *  dictionary. Detaching comes first so nothing is tombstoned or pushed -
 *  the share and every other user's copy stay exactly as they are. */
export function resetShoppingList(): void {
  deleteSetting(SHOPPING_SHARE_KEY_SETTING);
  clearAllShoppingItems();
  resetDictionary();
}


// ---------- Autocomplete dictionary ----------

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => '\\' + c);
}

/**
 * Up to `limit` dictionary entries starting with `prefix` (case-insensitive),
 * most-used first so past picks float to the top.
 */
export function suggestItems(prefix: string, limit = 3): DictionaryEntry[] {
  const p = prefix.trim().toLowerCase();
  if (!p) return [];
  return db.getAllSync<DictionaryEntry>(
    "SELECT id, name, uses FROM dictionary WHERE name_lower LIKE ? ESCAPE '\\' ORDER BY uses DESC, name_lower LIMIT ?",
    escapeLike(p) + '%',
    limit
  );
}

/**
 * Called whenever the user puts an item on the shopping list. Bumps the usage
 * count; unknown items are added to the dictionary; a known item typed with
 * different casing adopts the user's casing.
 */
export function recordItemUse(raw: string): void {
  const name = raw.trim();
  if (!name) return;
  const lower = name.toLowerCase();
  const existing = db.getFirstSync<{ id: number; name: string }>(
    'SELECT id, name FROM dictionary WHERE name_lower = ?',
    lower
  );
  if (existing) {
    db.runSync('UPDATE dictionary SET uses = uses + 1, name = ? WHERE id = ?', name, existing.id);
  } else {
    db.runSync('INSERT INTO dictionary (name, name_lower, uses) VALUES (?, ?, 1)', name, lower);
  }
}

export function getDictionary(filter = ''): DictionaryEntry[] {
  const f = filter.trim().toLowerCase();
  if (!f) {
    return db.getAllSync<DictionaryEntry>(
      'SELECT id, name, uses FROM dictionary ORDER BY name_lower'
    );
  }
  return db.getAllSync<DictionaryEntry>(
    "SELECT id, name, uses FROM dictionary WHERE name_lower LIKE ? ESCAPE '\\' ORDER BY name_lower",
    '%' + escapeLike(f) + '%'
  );
}

/** Adds an entry; case-insensitive duplicates are silently ignored, but a
 *  duplicate typed with different casing updates the stored casing. */
export function addDictionaryEntry(raw: string): void {
  const name = raw.trim();
  if (!name) return;
  const lower = name.toLowerCase();
  const existing = db.getFirstSync<{ id: number; name: string }>(
    'SELECT id, name FROM dictionary WHERE name_lower = ?',
    lower
  );
  if (existing) {
    if (existing.name !== name) {
      db.runSync('UPDATE dictionary SET name = ? WHERE id = ?', name, existing.id);
    }
    return;
  }
  db.runSync('INSERT INTO dictionary (name, name_lower) VALUES (?, ?)', name, lower);
}

/** Renames an entry; silently ignored if the new name is empty or collides
 *  (case-insensitively) with a different entry. */
export function editDictionaryEntry(id: number, raw: string): void {
  const name = raw.trim();
  if (!name) return;
  const lower = name.toLowerCase();
  const clash = db.getFirstSync<{ id: number }>(
    'SELECT id FROM dictionary WHERE name_lower = ? AND id != ?',
    lower,
    id
  );
  if (clash) return;
  db.runSync('UPDATE dictionary SET name = ?, name_lower = ? WHERE id = ?', name, lower, id);
}

export function deleteDictionaryEntry(id: number): void {
  db.runSync('DELETE FROM dictionary WHERE id = ?', id);
}

/** Deletes every entry and restores the built-in seed dictionary; custom
 *  entries and usage counts are discarded. */
export function resetDictionary(): void {
  db.withTransactionSync(() => {
    db.runSync('DELETE FROM dictionary');
    for (const item of SEED_FOOD_ITEMS) {
      db.runSync(
        'INSERT OR IGNORE INTO dictionary (name, name_lower) VALUES (?, ?)',
        item,
        item.toLowerCase()
      );
    }
  });
}
