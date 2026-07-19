export interface TodoList {
  id: number;
  name: string;
  position: number;
  /** Set when this list is synced with a server share; null for a plain local list. */
  shareKey: string | null;
}

export interface Task {
  id: number;
  listId: number;
  /** Stable identifier used to reconcile this task across devices when the
   *  list is shared; generated locally and never reused. */
  uuid: string;
  title: string;
  description: string;
  dueDate: string | null; // ISO date, e.g. "2026-07-15"
  colorIndex: number;
  done: boolean;
  createdAt: string;
}

export interface DictionaryEntry {
  id: number;
  name: string;
  uses: number;
}

export interface ShoppingItem {
  id: number;
  /** Stable identifier used to reconcile this item across devices when the
   *  shopping list is shared; generated locally and never reused. */
  uuid: string;
  name: string;
  checked: boolean;
  position: number;
}
