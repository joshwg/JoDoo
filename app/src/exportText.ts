// Human-readable list export, handed to the system share sheet (the
// "Export" button in a list's long-press dialog), and the matching parser
// behind "Import List" on the "+" menu. The parser accepts this exact
// export format back (round-trip) but also plain pasted text: one item per
// line, with or without checkbox/bullet prefixes.
import { formatIso, toIso } from './dates';
import { ShoppingItem, Task } from './types';

const CHECKED = '☑';
const UNCHECKED = '☐';

export function todoListToText(name: string, tasks: Task[]): string {
  const lines = [name];
  for (const t of tasks) {
    let line = `${t.done ? CHECKED : UNCHECKED} ${t.title}`;
    if (t.dueDate) line += ` — due ${formatIso(t.dueDate)}`;
    lines.push(line);
    // Indented so the description reads as belonging to the line above.
    if (t.description) lines.push(`    ${t.description}`);
  }
  return lines.join('\n');
}

export function shoppingListToText(name: string, items: ShoppingItem[]): string {
  const lines = [name];
  for (const i of items) {
    let line = `${i.checked ? CHECKED : UNCHECKED} ${i.name}`;
    if (i.amount) line += ` (${i.amount})`;
    lines.push(line);
  }
  return lines.join('\n');
}

export interface ParsedListItem {
  /** Item text with prefix/suffixes stripped. */
  text: string;
  checked: boolean;
  /** Trailing "(...)" - a shopping amount; todo import folds it back into the title. */
  amount: string | null;
  /** ISO date parsed from a trailing "— due ..." suffix, if one parses. */
  due: string | null;
  /** Indented continuation lines - a task description on round-trip. */
  note: string;
}

const CHECKED_PREFIX = /^(?:☑|✓|✔|\[[xX]\])\s*/;
const UNCHECKED_PREFIX = /^(?:☐|\[\s?\]|[-•*])\s*/;
const DUE_SUFFIX = /\s+[—–-]\s*due\s+(.+)$/i;
const AMOUNT_SUFFIX = /\s*\(([^()]+)\)\s*$/;

export function parseListText(raw: string): { name: string | null; items: ParsedListItem[] } {
  const lines = raw.split(/\r?\n/);
  // The first line is the list name only when the text looks like a list
  // export (some line carries a checkbox/bullet); otherwise a plain paste
  // like "Milk\nEggs" is all items and the list gets a default name.
  const anyPrefixed = lines.some(
    (l) => CHECKED_PREFIX.test(l.trim()) || UNCHECKED_PREFIX.test(l.trim())
  );
  let name: string | null = null;
  const items: ParsedListItem[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const indented = /^\s/.test(line);
    let text = line.trim();
    let checked = false;
    if (CHECKED_PREFIX.test(text)) {
      checked = true;
      text = text.replace(CHECKED_PREFIX, '');
    } else if (UNCHECKED_PREFIX.test(text)) {
      text = text.replace(UNCHECKED_PREFIX, '');
    } else if (indented && items.length > 0) {
      // Continuation of the previous item (an exported task description).
      const prev = items[items.length - 1];
      prev.note = prev.note ? `${prev.note}\n${text}` : text;
      continue;
    } else if (anyPrefixed && name == null && items.length === 0) {
      name = text;
      continue;
    }
    let due: string | null = null;
    const dueMatch = DUE_SUFFIX.exec(text);
    if (dueMatch) {
      const parsed = new Date(dueMatch[1]);
      if (!Number.isNaN(parsed.getTime())) {
        due = toIso(parsed);
        text = text.slice(0, dueMatch.index).trimEnd();
      }
    }
    let amount: string | null = null;
    const amountMatch = AMOUNT_SUFFIX.exec(text);
    if (amountMatch) {
      amount = amountMatch[1].trim();
      text = text.slice(0, amountMatch.index).trimEnd();
    }
    if (text) items.push({ text, checked, amount, due, note: '' });
  }
  return { name, items };
}
