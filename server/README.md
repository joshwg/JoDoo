# Jodoo sync server

A small Go service that lets multiple Jodoo app installs share and live-sync
a single todo list or shopping list. It does not replace each app's local
SQLite database - it only keeps a temporary, synchronized copy of shared
lists so peers can converge on the same content in real time.

## Running

```
JODOO_SERVER_KEY=<at-least-20-char-secret> DATA_DIR=/var/lib/jodoo go run .
```

For example (DO NOT USE THE SAMPLE KEY FOR YOUR SERVER):

```
JODOO_SERVER_KEY=8f3e2a9c1d7b4f6081ac5e2b3d9f1a7c DATA_DIR=/var/lib/jodoo go run .
```

Env vars:

- `JODOO_SERVER_KEY` (required): shared secret every client must present to
  use the server at all. Must be >= 20 characters. Generate one with e.g.
  `openssl rand -hex 12` and put it in the app's server settings and in this
  process's environment.
- `PORT` (default `8080`): plain HTTP port to listen on.
- `DATA_DIR` (default `./data`): directory holding `jodoo.db` (SQLite), the
  persistent-but-temporary store of shared lists.

Retention: shares are kept for 30 days from their last update; an hourly
sweep deletes anything older. Every edit resets the clock, and clients keep
their own local copy regardless, so an expired share only means the key stops
working - re-sharing the list mints a new one.

Flags:

- `--version`: print version and build information (Go version, git commit,
  commit date) and exit. Works without any env vars set:

  ```
  $ ./jodoo-server --version
  jodoo-server v1.2.1
    go:      go1.26.4 (linux/amd64)
    commit:  c18d01913340
    from:    2026-07-19T22:41:20Z
  ```

## TLS

This server only speaks plain HTTP. Run it behind a TLS-terminating reverse
proxy (Caddy, nginx, etc.) so all traffic to clients is encrypted end to end.
Example Caddyfile:

```
jodoo.example.com {
	reverse_proxy localhost:8080
}
```

Caddy automatically obtains a certificate and forwards both normal requests
and the WebSocket upgrade (`/ws/{key}`) to the Go service.

## API

All endpoints require the server key, either as `Authorization: Bearer <key>`
or query param `?serverKey=<key>` (the latter exists only because some
WebSocket clients can't set custom headers).

- `POST /api/lists` `{ "kind": "todo"|"shopping", "name": "...", "items": [...] }`
  -> creates a share, returns a freshly generated 20-char lowercase
  alphanumeric key plus the stored snapshot.
- `GET /api/lists/{key}` -> current snapshot for a share (used to preview/
  fetch before joining).
- `GET /ws/{key}` -> upgrades to a WebSocket. On connect the server
  immediately sends `{"type":"snapshot", ...}`. Either side can then send
  `{"type":"update","name":"...","items":[...]}`; the server stores it,
  bumps the version, and broadcasts the new snapshot to every connection in
  that share (including the sender).

The server itself stores each update wholesale and never merges - it is a
temporary sync aid, not a merge engine. Merging is done by the clients: every
item carries its own edit timestamp (plus tombstones for deletions), each
client folds incoming snapshots into its local state item by item, and pushes
the merged result back. Non-conflicting changes from different devices all
survive; when two devices edit the same item, the later edit wins.
