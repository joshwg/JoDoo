@AGENTS.md

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Layout

Two independent deliverables in one repo, with no shared build:

- `app/` - the Jodoo mobile app. Expo (React Native + TypeScript), targeting Android and iOS. This is the product; it works fully offline against a local SQLite database.
- `server/` - an optional Go sync service. Only involved when a user shares a list. It is not the home for anyone's data.

## Commands

App (run from `app/`):

```
npm install
npx expo start          # then open in Expo Go on the device
npm run typecheck       # tsc --noEmit - the only automated check in the repo
npx eas build -p android --profile preview    # cloud APK build, no local Android SDK
```

There is no test runner and no linter on the app side. `npm run typecheck` is the verification gate for TypeScript changes.

Server (run from `server/`):

```
go build ./...
go vet ./...
JODOO_SERVER_KEY=<20+ chars> DATA_DIR=./data go run .
```

There are no Go unit tests. Two shell scripts stand in for them:

- `.smoke_test.sh` builds the server, starts it on port 8099 against a throwaway data dir, and walks the REST API. Its `cd` line is hardcoded to a WSL path (`/home/josh/projects/Jodoo/server`) and needs editing to run elsewhere.
- `live_test.sh` runs the same checks plus a real WebSocket round trip against a deployed server (defaults to the production host, override with `BASE_URL`). It prompts for the server key unless `JODOO_SERVER_KEY` is set. `ws_check.py` does the WebSocket handshake by hand so this stays dependency-free.

## Expo version

The project is on SDK 57 (React Native 0.86, React 19.2), matching `AGENTS.md`. It was upgraded from SDK 54 because Expo Go ships support for one SDK version at a time, and the App Store copy had moved to 57, so the SDK 54 build could no longer be opened in Expo Go on a physical iPhone or iPad. Commit 1cb9223 had pinned it to 54 for the opposite reason, to match the Expo Go of that era. Expect that pressure to recur every time Expo Go moves.

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing code, per `AGENTS.md`.

### `@expo/config-plugins` is a deliberate devDependency

`npx expo-doctor` will tell you `@expo/config-plugins` "should not be installed directly" and advise removing it. Do not remove it. `@react-native-community/datetimepicker` 9.1.0 has a config plugin that does a bare `require('@expo/config-plugins')` while declaring it as neither a dependency nor a peer dependency, and SDK 57 nests that package under `expo/node_modules` where the plugin cannot resolve it. Without the top-level copy, `npx expo config` and therefore `expo-doctor`, `expo start`, and `eas build` all fail with `Cannot find module '@expo/config-plugins'`. Doctor's own message allows for this case: "If you installed @expo/config-plugins to fulfill a peer dependency for a config plugin ... you can ignore this warning."

Keep the pin exactly matching the version bundled inside `expo` (check `node_modules/expo/node_modules/@expo/config-plugins/package.json`) so there is only ever one behavioral copy. This can be dropped once datetimepicker switches to the `expo/config-plugins` sub-export.

### Splash screen config

SDK 57's config schema rejects the top-level `splash` key; splash settings live in the `expo-splash-screen` plugin entry in `app.json` instead. Note that the plugin sizes the image by an explicit `imageWidth` in dp rather than scaling to fit the screen the way the old `resizeMode: contain` did.

## Architecture

### Local data is the source of truth

`app/src/db.ts` owns everything: lists, tasks, shopping items, the autocomplete dictionary, and a key/value `settings` table. It opens `jodoo.db` at module load and exposes synchronous functions (`expo-sqlite`'s `*Sync` API), so components call it directly with no data layer in between. `App.tsx` calls `initDb()` in a `useMemo` before either section renders.

Schema changes go through `ensureColumn()`, which checks `PRAGMA table_info` because SQLite has no `ADD COLUMN IF NOT EXISTS`. Any new column also needs a backfill loop for rows that predate it (see how `uuid` was added to `tasks` and `shopping_items`).

### Sharing is a bolt-on, and stays that way

A list becomes shared when it gets a `share_key` (`lists.share_key` for todo lists, the `shopping_share_key` setting for the single shopping list). Everything else about the app is unchanged whether or not a server is configured.

The flow through the sync layer:

- `serverConfig.ts` holds the base URL and server key in `expo-secure-store`. No config means no sync, silently.
- `syncClient.ts` has the REST calls (`createShare`, `fetchShare`) and `ShareConnection`, an auto-reconnecting WebSocket wrapper with exponential backoff capped at 30s.
- `syncManager.ts` is the single owner of live connections. `refreshSyncConnections()` tears down and rebuilds every connection; call it after any change to sharing state or server settings. After a local edit, call `pushTodoListIfShared(listId)` or `pushShoppingIfShared()`.
- `remoteUpdates.ts` is a deliberately one-way event bus. Applying a remote snapshot emits an event so the visible screen refreshes, and that path must never loop back into a push. Keep that separation intact when adding sync-aware UI.

### Reconciliation is uuid-based, whole-list

Every task and shopping item carries a locally generated `uuid` that is never reused. The server always sends the entire list, so `applySyncedTasks` / `applySyncedShoppingItems` update known uuids in place, insert unknown ones, and delete local rows whose uuid is absent from the snapshot. Conflict resolution is last-write-wins by design.

### Server

Plain HTTP only, meant to sit behind a TLS-terminating reverse proxy. Routes are registered in `main.go` using Go 1.22+ method-and-pattern syntax, all wrapped in `requireAuth`.

The server treats list contents as opaque: `Item` is a `map[string]any` it stores and relays verbatim, so the client's item schema can change without touching Go code. `store.go` persists shares to SQLite with `SetMaxOpenConns(1)`; `hub.go` fans a share's updates out to every connected peer including the sender, dropping messages to slow consumers rather than blocking the room.

Two distinct secrets, easy to confuse:

- The **server key** (`JODOO_SERVER_KEY`, 20+ chars) gates access to the service at all. Compared in constant time. Accepted via `Authorization: Bearer`, `X-Server-Key`, or a `?serverKey=` query param, the last only because React Native's WebSocket client cannot reliably set handshake headers.
- A **share key** is a per-list 20-character lowercase alphanumeric secret generated by the server. It is meant to be read aloud or texted, which is why the alphabet is what it is.

## Conventions

- Version lives in three places that are kept in step: `app/package.json`, `app/app.json`, and the `Version` constant in `server/main.go`.
- Task card colors cycle through 8 pastels by index (`colors.ts`); new-list naming picks the smallest positive integer not already taken.
- Sections are switched by the bottom tab bar or a two-finger horizontal swipe wired up in `App.tsx`.
