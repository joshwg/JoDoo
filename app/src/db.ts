import * as SQLite from 'expo-sqlite';
import { SEED_FOOD_ITEMS } from './foodItems';
import { DictionaryEntry, ShoppingItem, Task, TodoList } from './types';

const db = SQLite.openDatabaseSync('jodoo.db');

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
  `);
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

// ---------- Lists ----------

interface ListRow {
  id: number;
  name: string;
  position: number;
}

export function getLists(): TodoList[] {
  return db.getAllSync<ListRow>('SELECT * FROM lists ORDER BY position, id');
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
  return { id: Number(res.lastInsertRowId), name, position: pos };
}

export function renameList(id: number, name: string): void {
  db.runSync('UPDATE lists SET name = ? WHERE id = ?', name.trim(), id);
}

export function deleteList(id: number): void {
  db.runSync('DELETE FROM tasks WHERE list_id = ?', id);
  db.runSync('DELETE FROM lists WHERE id = ?', id);
}

// ---------- Tasks ----------

interface TaskRow {
  id: number;
  list_id: number;
  title: string;
  description: string;
  due_date: string | null;
  color_index: number;
  done: number;
  created_at: string;
}

function toTask(r: TaskRow): Task {
  return {
    id: r.id,
    listId: r.list_id,
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
      'SELECT * FROM tasks WHERE list_id = ? ORDER BY done, due_date IS NULL, due_date, id',
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
  db.runSync(
    'INSERT INTO tasks (list_id, title, description, due_date, color_index) VALUES (?, ?, ?, ?, ?)',
    listId,
    title.trim(),
    description.trim(),
    dueDate,
    colorIndex
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

export function deleteTask(id: number): void {
  db.runSync('DELETE FROM tasks WHERE id = ?', id);
}

// ---------- Shopping ----------

interface ShoppingRow {
  id: number;
  name: string;
  checked: number;
  position: number;
}

export function getShoppingItems(): ShoppingItem[] {
  return db
    .getAllSync<ShoppingRow>('SELECT * FROM shopping_items ORDER BY checked, position, id')
    .map((r) => ({ id: r.id, name: r.name, checked: r.checked === 1, position: r.position }));
}

export function addShoppingItem(name: string): void {
  const pos = db.getFirstSync<{ p: number }>(
    'SELECT COALESCE(MAX(position), 0) + 1 AS p FROM shopping_items'
  )!.p;
  db.runSync('INSERT INTO shopping_items (name, position) VALUES (?, ?)', name.trim(), pos);
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
