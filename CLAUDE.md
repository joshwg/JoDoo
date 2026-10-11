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

- `.smoke_test.sh` builds the server, starts it on port 8099 against a throwaway data dir, and walks the REST API. It `cd`s to its own directory, so it can be run from anywhere.
- `tests/live_test.sh` runs the same checks plus a real WebSocket round trip against a deployed server (defaults to the production host, override with `BASE_URL`). It prompts for the server key unless `JODOO_SERVER_KEY` is set. `ws_check.py` does the WebSocket handshake by hand so this stays dependency-free.

## Expo version

The project is on SDK 57 (React Native 0.86, React 19.2), matching `AGENTS.md`. It was upgraded from SDK 54 because Expo Go ships support for one SDK version at a time, and the App Store copy had moved to 57, so the SDK 54 build could no longer be opened in Expo Go on a physical iPhone or iPad. Commit 1cb9223 had pinned it to 54 for the opposite reason, to match the Expo Go of that era. Expect that pressure to recur every time Expo Go moves.

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing code, per `AGENTS.md`.

### `@expo/config-plugins` is a deliberate devDependency

`npx expo-doctor` will tell you `@expo/config-plugins` "should not be installed directly" and advise removing it. Do not remove it. `@react-native-community/datetimepicker` 9.1.0 has a config plugin that does a bare `require('@expo/config-plugins')` while declaring it as neither a dependency nor a peer dependency, and SDK 57 nests that package under `expo/node_modules` where the plugin cannot resolve it. Without the top-level copy, `npx expo config` and therefore `expo-doctor`, `expo start`, and `eas build` all fail with `Cannot find module '@expo/config-plugins'`. Doctor's own message allows for this case: "If you installed @expo/config-plugins to fulfill a peer dependency for a config plugin ... you can ignore this warning."

Keep the pin matching what `expo` itself depends on, so there is only ever one behavioral copy. Verify with:

```
npm ls @expo/config-plugins                                       # every entry should say "deduped"
node -p "require('expo/package.json').dependencies['@expo/config-plugins']"   # the range to satisfy
```

As of the expo 57.0.9 bump (2026-08-03) npm hoists a single copy to `node_modules/@expo/config-plugins` at 57.0.6, satisfying expo's `~57.0.6`, and there is **no** nested copy under `expo/node_modules` — an earlier version of this note told you to check that path, which no longer exists. A nested copy reappearing means the pin has drifted out of expo's range.

This whole workaround can be dropped once datetimepicker switches to the `expo/config-plugins` sub-export. Re-check by removing the devDependency and running `npx expo config --type public`; if it succeeds, the workaround is no longer needed.

### npm `overrides` pins `uuid` under `xcode`

`app/package.json` carries `"overrides": { "xcode": { "uuid": "^11.1.1" } }` to clear npm audit's GHSA-w5hq-g745-h8pq: `xcode@3.0.1` (pulled in via `@expo/config-plugins`) declares `uuid@^7`, which is flagged. `xcode` only calls `uuid.v4()`, which v11 still exports, so the override is safe — `npx expo config --type public` verifies the pipeline. As of the expo 57.0.27 bump (2026-10-10, which also cleared the old image-size findings and, via `npm audit fix`, a critical in shell-quote), the remaining audit findings are `braces` (via metro) and `node-forge` (via `@expo/code-signing-certificates`) — both already at their latest versions with the advisories flagging **every** release, so there is nothing to upgrade to; re-run `npm audit` after Expo/metro updates before assuming that's still true. All flagged packages are dev/build-time tooling, not code shipped in the app binary.

### Splash screen config

SDK 57's config schema rejects the top-level `splash` key; splash settings live in the `expo-splash-screen` plugin entry in `app.json` instead. Note that the plugin sizes the image by an explicit `imageWidth` in dp rather than scaling to fit the screen the way the old `resizeMode: contain` did.

## Architecture

### Local data is the source of truth

`app/src/db.ts` owns everything: lists, tasks, shopping items, the autocomplete dictionary, and a key/value `settings` table. It opens `jodoo.db` at module load and exposes synchronous functions (`expo-sqlite`'s `*Sync` API), so components call it directly with no data layer in between. `App.tsx` calls `initDb()` in a `useMemo` before either section renders.

Schema changes are migrated inline in `initDb()`: check `PRAGMA table_info` before `ALTER TABLE ADD COLUMN` because SQLite has no `ADD COLUMN IF NOT EXISTS` (see how `amount` and `list_id` were added to `shopping_items`). Any new column also needs a backfill for rows that predate it. Only columns added since a released build need migrations — but note a stale dev database (e.g. an old Expo Go sandbox) can predate unmigrated columns like `position` and crash with "no such column"; the fix there is clearing Expo Go's storage, not a migration.

### Sharing is a bolt-on, and stays that way

A list becomes shared when it gets a `share_key` (`lists.share_key` for todo lists, `shopping_lists.share_key` for shopping lists). Everything else about the app is unchanged whether or not a server is configured.

A shared list can also be viewed and edited from a plain browser at `https://<server>/<key>` (`server/listpage.go`): a static, unauthenticated page whose JavaScript asks for the server key (localStorage), then joins the share over the same REST + WebSocket protocol as the app. It ports the item-level merge from `syncCore.ts` - change one and you must change the other. Any list can be duplicated from its long-press dialog ("Copy" - `db.copyList` / `db.copyShoppingList`): a brand-new local, unshared list with fresh uuids, which is how a member of a share preserves a private copy no other device can touch.

Joining is key-based and kind-agnostic: `joinShare.ts` fetches a key and lands it in whichever section it belongs to, no matter where it was entered. Three entry points feed it: manual key entry, a share link (`https://<server>/join/<key>`, handled by the unauthenticated landing page in `server/join.go` plus the `jodoo://join?key=...&server=...` deep link handled in `App.tsx` — the app's scheme is registered in `app.json`), and QR scanning (`JoinScanModal.tsx`, expo-camera; the QR encodes the https join link and is rendered in `ShareKeyModal.tsx` via react-native-qrcode-svg). Share links and QR codes carry the server address and list key but never the server access key - recipients must configure that out-of-band first. The one sanctioned shortcut for that is the server-setup QR in Server Settings (`serverSetup.ts`): a raw JSON payload (deliberately not a URL - only Jodoo's in-app scanner understands it) that carries the server address and access key from one trusted device to another.

The flow through the sync layer:

- `serverConfig.ts` holds the base URL and server key in `expo-secure-store`. No config means no sync, silently.
- `syncClient.ts` has the REST calls (`createShare`, `fetchShare`) and `ShareConnection`, an auto-reconnecting WebSocket wrapper with exponential backoff capped at 30s.
- `syncManager.ts` is the single owner of live connections. `refreshSyncConnections()` tears down and rebuilds every connection; call it after any change to sharing state or server settings. After a local edit, call `pushTodoListIfShared(listId)` or `pushShoppingListIfShared(listId)`.
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
- Long-pressing a task or shopping item opens its action menu (`ItemMenuModal`): Move to… another list (`moveTaskToList` / `moveShoppingItemToList` - tombstone the source scope, clear any stale tombstone in the destination scope), Copy to… (`copyTaskToList` / `copyShoppingItemToList` - a fresh row with a fresh uuid, source untouched, no tombstones involved), Edit (tasks open the task editor; shopping items open the name+amount dialog, `updateShoppingItem`), Delete, and Cross off (tasks toggle `done`, shopping items toggle `checked`). A long-press *drag* was tried first and abandoned - too easy to fumble; drags must start from a ☰ handle that claims the touch immediately. Both kinds of item have one: dropping it on another list's tab moves the item (task handles also reorder within the list; shopping's `ItemDragHandle` only moves). A list hosting a drag must set `scrollEnabled={false}` while one is active, because on Android the native ScrollView intercepts moves below the JS responder layer and `onPanResponderTerminationRequest: false` alone cannot hold the gesture.
- Lists round-trip as plain text: "Export" in the long-press dialog shares `exportText.ts`'s format (`☑/☐ <text>`, ` (amount)`, ` — due <date>`, indented description lines, first line = list name) via the system share sheet, and "Import List" on the "+" menu parses it back (`parseListText`, which also accepts arbitrary one-item-per-line text; `db.importTodoList` / `db.importShoppingList` create a new local, unshared list). Keep the exporter and parser in step.
- Sections are switched by the bottom tab bar or a two-finger horizontal swipe wired up in `App.tsx`. The same responder also handles two-finger pinch, which live-adjusts the persisted item text size (`textSettings.setFontSize`, same setting as the Font Settings dialog); whichever signal appears first wins - finger distance changing beyond 30px → pinch, parallel horizontal travel → swipe.
