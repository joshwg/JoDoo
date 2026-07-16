export function todayIso(): string {
  return toIso(new Date());
}

/** Default due date for a new task: today, or tomorrow when it's 8pm or later. */
export function defaultDueDate(): string {
  const now = new Date();
  if (now.getHours() >= 20) {
    now.setDate(now.getDate() + 1);
  }
  return toIso(now);
}

export function toIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function fromIso(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

export function formatIso(iso: string): string {
  const d = fromIso(iso);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

export function isOverdue(iso: string): boolean {
  return iso < todayIso();
}
