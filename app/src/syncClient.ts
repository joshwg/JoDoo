import { getServerConfig, normalizeBaseUrl, ServerConfig } from './serverConfig';

export type ListKind = 'todo' | 'shopping';

/** Opaque item payload exchanged with the server - callers translate to/from
 *  their own SyncTaskItem / SyncShoppingItem shapes. */
export type RemoteItem = Record<string, unknown>;

export interface ShareSnapshot {
  key: string;
  kind: ListKind;
  name: string;
  items: RemoteItem[];
  version: number;
  updatedAt: string;
}

export class ServerNotConfiguredError extends Error {
  constructor() {
    super('No server is configured. Add a server URL and key in Server Settings.');
    this.name = 'ServerNotConfiguredError';
  }
}

async function requireConfig(): Promise<ServerConfig> {
  const config = await getServerConfig();
  if (!config) throw new ServerNotConfiguredError();
  return config;
}

async function authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const config = await requireConfig();
  const baseUrl = normalizeBaseUrl(config.baseUrl);
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.serverKey}`,
      ...(init.headers ?? {}),
    },
  });
}

/** Owner action: generate a brand-new share key seeded with the list's
 *  current contents. */
export async function createShare(
  kind: ListKind,
  name: string,
  items: RemoteItem[]
): Promise<ShareSnapshot> {
  const res = await authedFetch('/api/lists', {
    method: 'POST',
    body: JSON.stringify({ kind, name, items }),
  });
  if (!res.ok) {
    throw new Error(`Could not create share (HTTP ${res.status})`);
  }
  return res.json();
}

/** Join action: fetch the current snapshot for a share key someone shared
 *  with you, without opening a live connection yet. */
export async function fetchShare(key: string): Promise<ShareSnapshot> {
  const res = await authedFetch(`/api/lists/${encodeURIComponent(key.trim())}`);
  if (res.status === 404) {
    throw new Error('That share key was not found.');
  }
  if (!res.ok) {
    throw new Error(`Could not fetch share (HTTP ${res.status})`);
  }
  return res.json();
}

/** Quick reachability + credential check for the Server Settings screen. */
export async function testServerConnection(config: ServerConfig): Promise<void> {
  const baseUrl = normalizeBaseUrl(config.baseUrl);
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/api/lists/__connection-test__`, {
      headers: { Authorization: `Bearer ${config.serverKey}` },
    });
  } catch (err) {
    throw new Error('Could not reach that server URL.');
  }
  if (res.status === 401) {
    throw new Error('Server rejected the key.');
  }
  if (res.status !== 404 && !res.ok) {
    throw new Error(`Unexpected response (HTTP ${res.status}).`);
  }
  // 404 here means auth succeeded and the server just doesn't know this
  // (deliberately bogus) key - i.e. the connection is good.
}

type SnapshotHandler = (snapshot: { name: string; items: RemoteItem[]; version: number }) => void;

/**
 * A live, auto-reconnecting WebSocket connection to one share. Delivers the
 * current snapshot on connect and whenever any peer (including us) pushes an
 * update.
 */
export class ShareConnection {
  private ws: WebSocket | null = null;
  private closed = false;
  private retryDelayMs = 1000;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly key: string,
    private readonly onSnapshot: SnapshotHandler
  ) {}

  async connect(): Promise<void> {
    if (this.closed) return;
    const config = await getServerConfig();
    if (!config || this.closed) return;

    const baseUrl = normalizeBaseUrl(config.baseUrl);
    const wsBase = baseUrl.replace(/^http/i, 'ws');
    const url = `${wsBase}/ws/${encodeURIComponent(this.key)}?serverKey=${encodeURIComponent(config.serverKey)}`;

    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onopen = () => {
      this.retryDelayMs = 1000;
    };
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(String(event.data));
        if (msg?.type === 'snapshot') {
          this.onSnapshot({ name: msg.name ?? '', items: msg.items ?? [], version: msg.version ?? 0 });
        }
      } catch {
        // ignore malformed frame
      }
    };
    ws.onclose = () => this.scheduleReconnect();
    ws.onerror = () => ws.close();
  }

  private scheduleReconnect(): void {
    if (this.closed) return;
    const delay = this.retryDelayMs;
    this.retryDelayMs = Math.min(this.retryDelayMs * 2, 30000);
    this.retryTimer = setTimeout(() => this.connect(), delay);
  }

  /** Pushes this device's current state; the server broadcasts the merged
   *  snapshot back to every connected peer, including us. */
  send(name: string, items: RemoteItem[]): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'update', name, items }));
    }
  }

  close(): void {
    this.closed = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.ws?.close();
    this.ws = null;
  }
}
