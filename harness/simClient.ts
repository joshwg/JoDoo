import { randomUUID } from 'node:crypto';
import {
  mergeRecords,
  normalizeTaskItems,
  SyncTaskItem,
  taskFingerprint,
  taskRecordKey,
} from '../app/src/syncCore';

interface WireMessage {
  type?: string;
  version?: number;
  name?: string;
  items?: SyncTaskItem[];
  updatedAt?: string;
  message?: string;
}

/**
 * A simulated Jodoo app instance for one shared todo list. Local state is an
 * in-memory stand-in for the app's SQLite tables (live tasks plus deletion
 * tombstones), but the sync behavior - record shapes, fingerprints, the
 * item-level merge, and the snapshot-handling control flow - is the same
 * code and the same decision sequence as app/src/syncManager.ts.
 */
export class SimClient {
  readonly label: string;
  listName = '';
  syncedVersion = 0;

  private readonly tasks = new Map<string, SyncTaskItem>();
  private readonly tombstones = new Map<string, string>();
  private readonly httpBase: string;
  private readonly serverKey: string;
  private shareKey = '';
  private ws: WebSocket | null = null;

  constructor(label: string, httpBase: string, serverKey: string) {
    this.label = label;
    this.httpBase = httpBase;
    this.serverKey = serverKey;
  }

  // ----- state inspection (for assertions) -----

  /** Full record set in canonical order: live by (position, uuid), then
   *  tombstones by uuid - mirrors db.getTaskSyncRecords. */
  records(): SyncTaskItem[] {
    const byUuid = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
    const live = [...this.tasks.values()].sort(
      (a, b) => a.position - b.position || byUuid(a.uuid, b.uuid)
    );
    const tombs = [...this.tombstones.entries()]
      .sort(([a], [b]) => byUuid(a, b))
      .map(
        ([uuid, updatedAt]): SyncTaskItem => ({
          uuid,
          title: '',
          description: '',
          dueDate: null,
          colorIndex: 0,
          done: false,
          position: 0,
          updatedAt,
          deleted: true,
        })
      );
    return [...live, ...tombs];
  }

  fingerprint(): string {
    return taskFingerprint(this.records());
  }

  titles(): string[] {
    return this.records()
      .filter((r) => !r.deleted)
      .map((r) => r.title);
  }

  task(uuid: string): SyncTaskItem | undefined {
    return this.tasks.get(uuid);
  }

  hasTombstone(uuid: string): boolean {
    return this.tombstones.has(uuid);
  }

  // ----- server API (mirrors the app's share/join flows) -----

  private headers(): Record<string, string> {
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${this.serverKey}` };
  }

  /** POST /api/lists with current content; adopts the returned key/version
   *  like db.setListShareKey does. */
  async createShare(name: string): Promise<string> {
    this.listName = name;
    const res = await fetch(`${this.httpBase}/api/lists`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ kind: 'todo', name, items: this.records() }),
    });
    if (!res.ok) throw new Error(`createShare: HTTP ${res.status}`);
    const body = (await res.json()) as { key: string; version: number };
    this.shareKey = body.key;
    this.syncedVersion = body.version;
    return body.key;
  }

  /** GET /api/lists/{key} and adopt the snapshot, like joining a share. */
  async join(key: string): Promise<void> {
    const res = await fetch(`${this.httpBase}/api/lists/${key}`, { headers: this.headers() });
    if (!res.ok) throw new Error(`join: HTTP ${res.status}`);
    const body = (await res.json()) as WireMessage;
    this.shareKey = key;
    this.listName = body.name ?? 'Shared List';
    this.applyMerged(normalizeTaskItems(body.items ?? []), body.version ?? 0);
  }

  // ----- live sync -----

  connect(): Promise<void> {
    const url = `${this.httpBase.replace(/^http/, 'ws')}/ws/${this.shareKey}?serverKey=${encodeURIComponent(this.serverKey)}`;
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onmessage = (ev) => {
      if (this.ws !== ws) return;
      let msg: WireMessage;
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (msg.type === 'snapshot') this.handleSnapshot(msg);
    };
    return new Promise((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error(`${this.label}: websocket failed`));
    });
  }

  disconnect(): void {
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onmessage = null;
      ws.close();
    }
  }

  /** The same arbitration sequence as syncManager.handleTodoSnapshot. */
  private handleSnapshot(msg: WireMessage): void {
    const version = msg.version ?? 0;
    if (version < this.syncedVersion) return;
    const local = this.records();
    const remote = normalizeTaskItems(msg.items ?? []);
    const merged = mergeRecords(local, remote, taskRecordKey);
    const mergedFp = taskFingerprint(merged);
    const needPush = mergedFp !== taskFingerprint(remote);
    if (mergedFp !== taskFingerprint(local)) {
      this.applyMerged(merged, version);
    } else {
      this.syncedVersion = Math.max(this.syncedVersion, version);
    }
    if (msg.name) this.listName = msg.name;
    if (needPush) this.push();
  }

  private applyMerged(merged: SyncTaskItem[], version: number): void {
    this.tasks.clear();
    this.tombstones.clear();
    for (const r of merged) {
      if (r.deleted) this.tombstones.set(r.uuid, r.updatedAt);
      else this.tasks.set(r.uuid, r);
    }
    this.syncedVersion = Math.max(this.syncedVersion, version);
  }

  private push(): void {
    this.ws?.send(
      JSON.stringify({
        type: 'update',
        name: this.listName,
        items: this.records(),
        updatedAt: new Date().toISOString(),
      })
    );
  }

  // ----- local edits (each pushes immediately, like the app) -----

  addTask(title: string): string {
    const uuid = randomUUID();
    const position = Math.max(-1, ...[...this.tasks.values()].map((t) => t.position)) + 1;
    this.tasks.set(uuid, {
      uuid,
      title,
      description: '',
      dueDate: null,
      colorIndex: this.tasks.size % 8,
      done: false,
      position,
      updatedAt: new Date().toISOString(),
    });
    this.push();
    return uuid;
  }

  editTask(uuid: string, title: string): void {
    const t = this.tasks.get(uuid);
    if (!t) throw new Error(`${this.label}: no task ${uuid}`);
    this.tasks.set(uuid, { ...t, title, updatedAt: new Date().toISOString() });
    this.push();
  }

  setDone(uuid: string, done: boolean): void {
    const t = this.tasks.get(uuid);
    if (!t) throw new Error(`${this.label}: no task ${uuid}`);
    this.tasks.set(uuid, { ...t, done, updatedAt: new Date().toISOString() });
    this.push();
  }

  deleteTask(uuid: string): void {
    if (!this.tasks.delete(uuid)) throw new Error(`${this.label}: no task ${uuid}`);
    this.tombstones.set(uuid, new Date().toISOString());
    this.push();
  }

  /** Mirrors db.reorderTasks: assigns positions by the given order, touching
   *  the edit time only on tasks whose position actually changed. */
  reorder(orderedUuids: string[]): void {
    const now = new Date().toISOString();
    orderedUuids.forEach((uuid, index) => {
      const t = this.tasks.get(uuid);
      if (!t) throw new Error(`${this.label}: no task ${uuid}`);
      if (t.position !== index) {
        this.tasks.set(uuid, { ...t, position: index, updatedAt: now });
      }
    });
    this.push();
  }
}
