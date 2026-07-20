import { getServerConfig, normalizeBaseUrl, ServerConfig } from './serverConfig';

export type ListKind = 'todo' | 'shopping';

/** Opaque item payload exchanged with the server - callers translate to/from
 *  their own SyncTaskItem / SyncShoppingItem shapes. */
export type RemoteItem = Record<string, unknown>;

/** The payload common to every snapshot the server delivers, whether over
 *  REST or as a WebSocket frame. The single source of truth for this shape -
 *  syncManager's arbitration consumes it directly. */
export interface SharePayload {
  name: string;
  items: RemoteItem[];
  version: number;
  updatedAt: string;
}

export interface ShareSnapshot extends SharePayload {
  key: string;
  kind: ListKind;
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

type SnapshotHandler = (snapshot: SharePayload) => void;

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
    // connect() is fired without an awaiting caller (startup, reconnect
    // timer), so any escape here would both surface as an unhandled
    // rejection and permanently end this share's reconnect loop.
    let config: ServerConfig | null;
    try {
      config = await getServerConfig();
    } catch {
      this.scheduleReconnect();
      return;
    }
    if (!config || this.closed) return;

    const baseUrl = normalizeBaseUrl(config.baseUrl);
    const wsBase = baseUrl.replace(/^http/i, 'ws');
    const url = `${wsBase}/ws/${encodeURIComponent(this.key)}?serverKey=${encodeURIComponent(config.serverKey)}`;

    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      this.retryDelayMs = 1000;
    };
    ws.onmessage = (event) => {
      // Frames from a superseded or closed socket must not reach the
      // handler - they may belong to a share this device has since re-bound.
      if (this.closed || this.ws !== ws) return;
      let msg: { type?: string; name?: string; items?: RemoteItem[]; version?: number; updatedAt?: string };
      try {
        msg = JSON.parse(String(event.data));
      } catch {
        return; // ignore malformed frame
      }
      if (msg?.type !== 'snapshot') return;
      try {
        this.onSnapshot({
          name: msg.name ?? '',
          items: msg.items ?? [],
          version: msg.version ?? 0,
          updatedAt: msg.updatedAt ?? '',
        });
      } catch (err) {
        // A failed apply must not be mistaken for a malformed frame; log it
        // so a device that stops converging is diagnosable.
        console.warn('sync: failed to handle snapshot', err);
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
   *  snapshot back to every connected peer, including us. `updatedAt` is
   *  this device's own last-edit time - the server relays it so conflict
   *  tie-breaks on other devices compare device clocks against device
   *  clocks, never against the server's. */
  send(name: string, items: RemoteItem[], updatedAt: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      // Omit a blank timestamp entirely: Go cannot unmarshal "" as a time.
      this.ws.send(
        JSON.stringify({ type: 'update', name, items, ...(updatedAt ? { updatedAt } : {}) })
      );
    }
  }

  close(): void {
    this.closed = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.ws) {
      // Detach before closing: queued events may still be delivered after
      // close() is called.
      this.ws.onmessage = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.close();
    }
    this.ws = null;
  }
}
