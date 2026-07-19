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
  const res = db.runSync(
    'INSERT INTO lists (name, position, share_key) VALUES (?, ?, ?)',
    name,
    pos,
    shareKey
  );
  return { id: Number(res.lastInsertRowId), name, position: pos, shareKey };
}

/** Marks an existing list as shared once the owner has generated a key for it. */
export function setListShareKey(id: number, shareKey: string): void {
  db.runSync('UPDATE lists SET share_key = ? WHERE id = ?', shareKey, id);
}

export function renameList(id: number, name: string): void {
  db.runSync('UPDATE lists SET name = ? WHERE id = ?', name.trim(), id);
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
}

export function setTaskDone(id: number, done: boolean): void {
  db.runSync('UPDATE tasks SET done = ? WHERE id = ?', done ? 1 : 0, id);
}

/** Moves a task to a different list (used by drag-and-drop in the UI); it is
 *  appended to the end of the destination list. */
export function moveTaskToList(id: number, newListId: number): void {
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
}

/** Persists a new task order within a list (used by drag-to-reorder in the UI). */
export function reorderTasks(listId: number, orderedIds: number[]): void {
  db.withTransactionSync(() => {
    orderedIds.forEach((id, index) => {
      db.runSync('UPDATE tasks SET position = ? WHERE id = ? AND list_id = ?', index, id, listId);
    });
  });
}

export function deleteTask(id: number): void {
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

/**
 * Replaces a list's tasks with a snapshot received from the sync server.
 * Tasks are matched by `uuid`: known uuids are updated in place, unknown
 * ones are inserted, and local tasks whose uuid is missing from the
 * snapshot are deleted (the server always sends the whole list).
 */
export function applySyncedTasks(listId: number, items: SyncTaskItem[]): void {
  db.withTransactionSync(() => {
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
      const colorIndex = Number.isFinite(item.colorIndex) ? item.colorIndex : index % 8;
      if (existingId != null) {
        db.runSync(
          'UPDATE tasks SET title = ?, description = ?, due_date = ?, color_index = ?, done = ?, position = ? WHERE id = ?',
          item.title,
          item.description,
          item.dueDate,
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
          item.title,
          item.description,
          item.dueDate,
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
}

export function setShoppingChecked(id: number, checked: boolean): void {
  db.runSync('UPDATE shopping_items SET checked = ? WHERE id = ?', checked ? 1 : 0, id);
}

export function deleteShoppingItem(id: number): void {
  db.runSync('DELETE FROM shopping_items WHERE id = ?', id);
}

export function clearCheckedShoppingItems(): void {
  db.runSync('DELETE FROM shopping_items WHERE checked = 1');
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

/** Same reconciliation strategy as {@link applySyncedTasks}, for the single
 *  shopping list. */
export function applySyncedShoppingItems(items: SyncShoppingItem[]): void {
  db.withTransactionSync(() => {
    const existing = db.getAllSync<{ id: number; uuid: string }>(
      'SELECT id, uuid FROM shopping_items'
    );
    const byUuid = new Map(existing.map((e) => [e.uuid, e.id]));
    const seen = new Set<string>();
    items.forEach((item, index) => {
      if (!item.uuid) return;
      seen.add(item.uuid);
      const existingId = byUuid.get(item.uuid);
      if (existingId != null) {
        db.runSync(
          'UPDATE shopping_items SET name = ?, checked = ?, position = ? WHERE id = ?',
          item.name,
          item.checked ? 1 : 0,
          index,
          existingId
        );
      } else {
        db.runSync(
          'INSERT INTO shopping_items (name, uuid, checked, position) VALUES (?, ?, ?, ?)',
          item.name,
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
 *  else's shared shopping list via its key. */
export function clearAllShoppingItems(): void {
  db.runSync('DELETE FROM shopping_items');
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
