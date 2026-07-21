// Pure, dependency-free core of the list-sync protocol: the wire item
// shapes, content fingerprints, and the item-level last-write-wins merge.
// Kept free of expo/react-native imports so the test harness (harness/) can
// exercise exactly the same code the app ships.

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

/**
 * Plain-object shape sent to / received from the sync server for a task.
 * `updatedAt` is the device edit time driving item-level last-write-wins;
 * `deleted: true` marks a tombstone (only `uuid` and `updatedAt` are
 * meaningful on those). All devices in a share must understand this shape -
 * merging happens on the clients, the server stores it opaquely.
 */
export interface SyncTaskItem {
  uuid: string;
  title: string;
  description: string;
  dueDate: string | null;
  colorIndex: number;
  done: boolean;
  position: number;
  updatedAt: string;
  deleted?: boolean;
}

/** Coerces items that arrived via the untyped relay (possibly from another
 *  build) into fully populated {@link SyncTaskItem}s, so one bad item can't
 *  abort a whole merge or apply. */
export function normalizeTaskItems(items: SyncTaskItem[]): SyncTaskItem[] {
  return items
    .filter((i) => i && typeof i.uuid === 'string' && i.uuid !== '')
    .map((i, index) => ({
      uuid: i.uuid,
      title: String(i.title ?? ''),
      description: String(i.description ?? ''),
      dueDate: i.dueDate ?? null,
      colorIndex: Number.isFinite(i.colorIndex) ? i.colorIndex : index % 8,
      done: !!i.done,
      position: Number.isFinite(i.position) ? i.position : index,
      updatedAt: typeof i.updatedAt === 'string' ? i.updatedAt : '',
      ...(i.deleted === true ? { deleted: true } : {}),
    }));
}

/** Fixed-field-order projection of one task record; the unit both of content
 *  fingerprints and of deterministic merge tie-breaking. Projection (rather
 *  than raw JSON) because the server stores items as opaque maps and
 *  re-serializes their keys alphabetically. Must enumerate exactly the
 *  fields of {@link SyncTaskItem}. */
export function taskRecordKey(i: SyncTaskItem): string {
  return JSON.stringify([
    i.uuid,
    i.title,
    i.description,
    i.dueDate ?? null,
    i.colorIndex,
    !!i.done,
    i.position,
    i.updatedAt,
    i.deleted === true,
  ]);
}

/** Canonical content fingerprint for comparing record sets. */
export function taskFingerprint(items: SyncTaskItem[]): string {
  return JSON.stringify(items.map(taskRecordKey));
}

/** Shopping counterpart of {@link SyncTaskItem}; same merge semantics. */
export interface SyncShoppingItem {
  uuid: string;
  name: string;
  checked: boolean;
  position: number;
  updatedAt: string;
  /** Optional free-form quantity, e.g. "12" or "1.2 pounds"; null/absent
   *  shows no amount. */
  amount?: string | null;
  deleted?: boolean;
}

/** Shopping counterpart of {@link normalizeTaskItems}. */
export function normalizeShoppingItems(items: SyncShoppingItem[]): SyncShoppingItem[] {
  return items
    .filter((i) => i && typeof i.uuid === 'string' && i.uuid !== '')
    .map((i, index) => ({
      uuid: i.uuid,
      name: String(i.name ?? ''),
      checked: !!i.checked,
      position: Number.isFinite(i.position) ? i.position : index,
      updatedAt: typeof i.updatedAt === 'string' ? i.updatedAt : '',
      amount: typeof i.amount === 'string' && i.amount !== '' ? i.amount : null,
      ...(i.deleted === true ? { deleted: true } : {}),
    }));
}

/** Shopping counterpart of {@link taskRecordKey}. */
export function shoppingRecordKey(i: SyncShoppingItem): string {
  return JSON.stringify([
    i.uuid,
    i.name,
    !!i.checked,
    i.position,
    i.updatedAt,
    i.amount ?? null,
    i.deleted === true,
  ]);
}

/** Like {@link taskFingerprint}, for {@link SyncShoppingItem}. */
export function shoppingFingerprint(items: SyncShoppingItem[]): string {
  return JSON.stringify(items.map(shoppingRecordKey));
}

// ---------- Item-level merge ----------
//
// Local and remote copies of a shared list are reconciled record by record:
// every record (live item or deletion tombstone) carries its own edit time,
// and for each uuid the newer edit wins. Non-conflicting changes from
// different devices therefore all survive; only edits to the *same* item
// conflict, and there the later change takes effect. Records whose edit
// times tie exactly are settled by comparing their canonical serializations,
// an arbitrary but deterministic rule - every device picks the same winner,
// which is what makes repeated merges converge instead of ping-ponging.

/** The fields the merge itself needs; both item shapes satisfy it. */
export interface SyncRecord {
  uuid: string;
  position: number;
  updatedAt: string;
  deleted?: boolean;
}

export function mergeRecords<T extends SyncRecord>(
  local: T[],
  remote: T[],
  recordKey: (r: T) => string
): T[] {
  const chosen = new Map<string, T>();
  const consider = (r: T) => {
    const prev = chosen.get(r.uuid);
    if (!prev) {
      chosen.set(r.uuid, r);
      return;
    }
    const tPrev = parseSyncTimestamp(prev.updatedAt);
    const tNext = parseSyncTimestamp(r.updatedAt);
    if (tNext > tPrev || (tNext === tPrev && recordKey(r) < recordKey(prev))) {
      chosen.set(r.uuid, r);
    }
  };
  local.forEach(consider);
  remote.forEach(consider);
  const all = [...chosen.values()];
  const byUuid = (a: T, b: T) => (a.uuid < b.uuid ? -1 : a.uuid > b.uuid ? 1 : 0);
  const live = all
    .filter((r) => !r.deleted)
    .sort((a, b) => a.position - b.position || byUuid(a, b));
  const tombstones = all.filter((r) => r.deleted).sort(byUuid);
  return [...live, ...tombstones];
}
