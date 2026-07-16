export interface TodoList {
  id: number;
  name: string;
  position: number;
}

export interface Task {
  id: number;
  listId: number;
  title: string;
  description: string;
  dueDate: string | null; // ISO date, e.g. "2026-07-15"
  colorIndex: number;
  done: boolean;
  createdAt: string;
}

export interface ShoppingItem {
  id: number;
  name: string;
  checked: boolean;
  position: number;
}
