import * as SQLite from 'expo-sqlite';
import { SEED_FOOD_ITEMS } from './foodItems';
import { DictionaryEntry, ShoppingItem, Task, TodoList } from './types';
import { generateUuid } from './uuid';

const db = SQLite.openDatabaseSync('jodoo.db');

/** Adds `column` to `table` if it isn't already there (SQLite has no
 *  "ADD COLUMN IF NOT EXISTS", so we check PRAGMA table_info first). */
function ensureColumn(table: string, column: string, definition: string): void {
  const cols = db.getAllSync<{ name: string }>(`PRAGMA table_info(${table})`);
  if (!cols.some((c) => c.name === column)) {
    db.execSync(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

export function initDb(): void {
  db.execSync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS lists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      list_id INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      due_date TEXT,
      color_index INTEGER NOT NULL DEFAULT 0,
      done INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS shopping_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      checked INTEGER NOT NULL DEFAULT 0,
      position INTEGER NOT NULL DEFAULT 0
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
  `);

  // Migrations for list/task sharing support (added after first release).
  ensureColumn('lists', 'share_key', 'TEXT');
  // Sync state per list: the server version last adopted from a snapshot, a
  // dirty flag set by every local edit and cleared when the server
  // acknowledges our content, and the wall-clock time of the last local edit
  // (only consulted as a tie-break for genuine concurrent-edit conflicts).
  ensureColumn('lists', 'synced_version', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('lists', 'dirty', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('lists', 'updated_at', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('tasks', 'uuid', 'TEXT');
  ensureColumn('shopping_items', 'uuid', 'TEXT');
  // Backfill any pre-existing rows that predate the uuid column.
  for (const row of db.getAllSync<{ id: number }>('SELECT id FROM tasks WHERE uuid IS NULL')) {
    db.runSync('UPDATE tasks SET uuid = ? WHERE id = ?', generateUuid(), row.id);
  }
  for (const row of db.getAllSync<{ id: number }>(
    'SELECT id FROM shopping_items WHERE uuid IS NULL'
  )) {
    db.runSync('UPDATE shopping_items SET uuid = ? WHERE id = ?', generateUuid(), row.id);
  }

  // Migration: explicit per-list task ordering (added to support drag-to-reorder).
  ensureColumn('tasks', 'position', 'INTEGER NOT NULL DEFAULT 0');
  if (getSetting('_migrated_task_positions') !== '1') {
    for (const list of db.getAllSync<{ id: number }>('SELECT id FROM lists')) {
      const rows = db.getAllSync<{ id: number }>(
        'SELECT id FROM tasks WHERE list_id = ? ORDER BY done, due_date IS NULL, due_date, id',
        list.id
      );
      rows.forEach((row, i) => db.runSync('UPDATE tasks SET position = ? WHERE id = ?', i, row.id));
    }
    setSetting('_migrated_task_positions', '1');
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
// Arbitration between local and remote copies of a shared list rests on the
// server's monotonically increasing version counter plus a local dirty flag,
// not on comparing clocks. Wall-clock timestamps are recorded on local edits
// only as a tie-break for genuine concurrent-edit conflicts, where any
// choice is defensible.

/**
 * Parses an ISO/RFC3339 timestamp to epoch milliseconds. Go's RFC3339Nano
 * trims trailing zeros so fractional seconds arrive with 1-9 digits, while
 * ECMA-262 only guarantees parsing of exactly 3; normalize before parsing.
 * Blank/bad input parses as 0, i.e. "older than everything".
 */
export function parseSyncTimestamp(ts: string): number {
  if (!ts) return 0;
  const ms = Date.parse(ts.replace(/\.(\d+)/, (_, f: string) => '.' + (f + '00').slice(0, 3)));
  return Number.isNaN(ms) ? 0 : ms;
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
  db.runSync('DELETE FROM lists WHERE id = ?', id);
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
    'INSERT INTO tasks (list_id, uuid, title, description, due_date, color_index, position) VALUES (?, ?, ?, ?, ?, ?, ?)',
    listId,
    generateUuid(),
    title.trim(),
    description.trim(),
    dueDate,
    colorIndex,
    position
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
    'UPDATE tasks SET title = ?, description = ?, due_date = ? WHERE id = ?',
    title.trim(),
    description.trim(),
    dueDate,
    id
  );
  markListOfTaskDirty(id);
}

export function setTaskDone(id: number, done: boolean): void {
  db.runSync('UPDATE tasks SET done = ? WHERE id = ?', done ? 1 : 0, id);
  markListOfTaskDirty(id);
}

/** Moves a task to a different list (used by drag-and-drop in the UI); it is
 *  appended to the end of the destination list. */
export function moveTaskToList(id: number, newListId: number): void {
  // Mark the source list while the task still points at it.
  markListOfTaskDirty(id);
  const position = db.getFirstSync<{ p: number }>(
    'SELECT COALESCE(MAX(position), -1) + 1 AS p FROM tasks WHERE list_id = ?',
    newListId
  )!.p;
  db.runSync(
    'UPDATE tasks SET list_id = ?, position = ? WHERE id = ?',
    newListId,
    position,
    id
  );
  markListDirty(newListId);
}

/** Persists a new task order within a list (used by drag-to-reorder in the UI). */
export function reorderTasks(listId: number, orderedIds: number[]): void {
  db.withTransactionSync(() => {
    orderedIds.forEach((id, index) => {
      db.runSync('UPDATE tasks SET position = ? WHERE id = ? AND list_id = ?', index, id, listId);
    });
  });
  markListDirty(listId);
}

export function deleteTask(id: number): void {
  // Mark first: the list lookup needs the task row to still exist.
  markListOfTaskDirty(id);
  db.runSync('DELETE FROM tasks WHERE id = ?', id);
}

// ---------- Sync: todo list snapshot export/apply ----------

/** Plain-object shape sent to / received from the sync server for a task. */
export interface SyncTaskItem {
  uuid: string;
  title: string;
  description: string;
  dueDate: string | null;
  colorIndex: number;
  done: boolean;
}

/** The current contents of a list, shaped for pushing to the sync server. */
export function getTasksAsSyncItems(listId: number): SyncTaskItem[] {
  return getTasks(listId).map((t) => ({
    uuid: t.uuid,
    title: t.title,
    description: t.description,
    dueDate: t.dueDate,
    colorIndex: t.colorIndex,
    done: t.done,
  }));
}

/** Canonical content fingerprint for comparing a local list against a
 *  snapshot. Projects each item onto a fixed field order because the server
 *  stores items as opaque maps and re-serializes their keys alphabetically,
 *  so raw JSON comparison would always mismatch. Must enumerate exactly the
 *  fields of {@link SyncTaskItem}. */
export function taskFingerprint(items: SyncTaskItem[]): string {
  return JSON.stringify(
    items.map((i) => [i.uuid, i.title, i.description, i.dueDate ?? null, i.colorIndex, !!i.done])
  );
}

/**
 * Replaces a list's name and tasks with a snapshot received from the sync
 * server, adopts the snapshot's server version (never moving backwards), and
 * clears the dirty flag - the server now holds this content. Tasks are
 * matched by `uuid`: known uuids are updated in place, unknown ones are
 * inserted, and local tasks whose uuid is missing from the snapshot are
 * deleted (the server always sends the whole list).
 */
export function applySyncedTasks(
  listId: number,
  name: string,
  items: SyncTaskItem[],
  version: number
): void {
  db.withTransactionSync(() => {
    db.runSync(
      "UPDATE lists SET name = COALESCE(NULLIF(?, ''), name), synced_version = MAX(synced_version, ?), dirty = 0 WHERE id = ?",
      name,
      version,
      listId
    );
    const existing = db.getAllSync<{ id: number; uuid: string }>(
      'SELECT id, uuid FROM tasks WHERE list_id = ?',
      listId
    );
    const byUuid = new Map(existing.map((e) => [e.uuid, e.id]));
    const seen = new Set<string>();
    items.forEach((item, index) => {
      if (!item.uuid) return;
      seen.add(item.uuid);
      const existingId = byUuid.get(item.uuid);
      // Items arrive via an untyped relay from other builds; default any
      // missing field rather than letting one bad item abort every apply.
      const title = String(item.title ?? '');
      const description = String(item.description ?? '');
      const dueDate = item.dueDate ?? null;
      const colorIndex = Number.isFinite(item.colorIndex) ? item.colorIndex : index % 8;
      if (existingId != null) {
        db.runSync(
          'UPDATE tasks SET title = ?, description = ?, due_date = ?, color_index = ?, done = ?, position = ? WHERE id = ?',
          title,
          description,
          dueDate,
          colorIndex,
          item.done ? 1 : 0,
          index,
          existingId
        );
      } else {
        db.runSync(
          'INSERT INTO tasks (list_id, uuid, title, description, due_date, color_index, done, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          listId,
          item.uuid,
          title,
          description,
          dueDate,
          colorIndex,
          item.done ? 1 : 0,
          index
        );
      }
    });
    for (const e of existing) {
      if (!seen.has(e.uuid)) {
        db.runSync('DELETE FROM tasks WHERE id = ?', e.id);
      }
    }
  });
}

// ---------- Shopping ----------

interface ShoppingRow {
  id: number;
  uuid: string;
  name: string;
  checked: number;
  position: number;
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
    }));
}

export function addShoppingItem(name: string): void {
  const pos = db.getFirstSync<{ p: number }>(
    'SELECT COALESCE(MAX(position), 0) + 1 AS p FROM shopping_items'
  )!.p;
  db.runSync(
    'INSERT INTO shopping_items (name, uuid, position) VALUES (?, ?, ?)',
    name.trim(),
    generateUuid(),
    pos
  );
  markShoppingDirty();
}

export function setShoppingChecked(id: number, checked: boolean): void {
  db.runSync('UPDATE shopping_items SET checked = ? WHERE id = ?', checked ? 1 : 0, id);
  markShoppingDirty();
}

export function deleteShoppingItem(id: number): void {
  db.runSync('DELETE FROM shopping_items WHERE id = ?', id);
  markShoppingDirty();
}

export function clearCheckedShoppingItems(): void {
  db.runSync('DELETE FROM shopping_items WHERE checked = 1');
  markShoppingDirty();
}

// ---------- Sync: shopping list snapshot export/apply ----------

export interface SyncShoppingItem {
  uuid: string;
  name: string;
  checked: boolean;
}

export function getShoppingItemsAsSyncItems(): SyncShoppingItem[] {
  return getShoppingItems().map((i) => ({ uuid: i.uuid, name: i.name, checked: i.checked }));
}

/** Like {@link taskFingerprint}, for {@link SyncShoppingItem}. */
export function shoppingFingerprint(items: SyncShoppingItem[]): string {
  return JSON.stringify(items.map((i) => [i.uuid, i.name, !!i.checked]));
}

/** Same reconciliation strategy as {@link applySyncedTasks}, for the single
 *  shopping list; likewise adopts the server version and clears dirty. */
export function applySyncedShoppingItems(items: SyncShoppingItem[], version: number): void {
  db.withTransactionSync(() => {
    const current = Number(getSetting(SHOPPING_SYNCED_VERSION_SETTING) ?? 0);
    setSetting(SHOPPING_SYNCED_VERSION_SETTING, String(Math.max(current, version)));
    setSetting(SHOPPING_DIRTY_SETTING, '0');
    const existing = db.getAllSync<{ id: number; uuid: string }>(
      'SELECT id, uuid FROM shopping_items'
    );
    const byUuid = new Map(existing.map((e) => [e.uuid, e.id]));
    const seen = new Set<string>();
    items.forEach((item, index) => {
      if (!item.uuid) return;
      seen.add(item.uuid);
      const existingId = byUuid.get(item.uuid);
      // Untyped relay: default missing fields, as in applySyncedTasks.
      const name = String(item.name ?? '');
      if (existingId != null) {
        db.runSync(
          'UPDATE shopping_items SET name = ?, checked = ?, position = ? WHERE id = ?',
          name,
          item.checked ? 1 : 0,
          index,
          existingId
        );
      } else {
        db.runSync(
          'INSERT INTO shopping_items (name, uuid, checked, position) VALUES (?, ?, ?, ?)',
          name,
          item.uuid,
          item.checked ? 1 : 0,
          index
        );
      }
    });
    for (const e of existing) {
      if (!seen.has(e.uuid)) {
        db.runSync('DELETE FROM shopping_items WHERE id = ?', e.id);
      }
    }
  });
}

/** Deletes every local shopping item; used right before adopting someone
 *  else's shared shopping list via its key. Resets the sync state so the new
 *  share's first snapshot always applies. */
export function clearAllShoppingItems(): void {
  db.runSync('DELETE FROM shopping_items');
  deleteSetting(SHOPPING_SYNCED_VERSION_SETTING);
  deleteSetting(SHOPPING_DIRTY_SETTING);
  deleteSetting(SHOPPING_UPDATED_AT_SETTING);
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
