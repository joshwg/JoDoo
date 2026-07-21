/**
 * One-way event bus: the sync layer emits an event whenever it applies a
 * remote snapshot to the local database, so any currently-visible screen can
 * refresh. This is intentionally separate from "push my local change to the
 * server" (see syncManager.ts) so applying a remote update never triggers a
 * push right back to the server.
 */
export type RemoteUpdateTarget = { type: 'todo'; listId: number } | { type: 'shopping' };

type Listener = (target: RemoteUpdateTarget) => void;

const listeners = new Set<Listener>();

export function subscribeRemoteUpdate(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function emitRemoteUpdate(target: RemoteUpdateTarget): void {
  listeners.forEach((fn) => {
    try {
      fn(target);
    } catch (err) {
      console.warn('remoteUpdate listener threw:', err);
    }
  });
}
