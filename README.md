# Jodoo

A simple Android to-do and shopping list app. No accounts, no passwords — everything is stored locally on the device in SQLite.

Built with Expo (React Native + TypeScript), following the same WSL + EAS workflow as `flightscan/apps/mobile`.

## Sections

**To Do** — a set of to-do lists, one per tab.

- Tap the `+` tab to add a list. New lists are named `To Do N`, where N is the smallest positive integer that doesn't collide with an existing tab name.
- Long-press a tab to rename or delete the list.
- Tap the `+` button at the top of a list to add a task.
- Tasks have a bold title, an optional description (first line visible; tap the card to expand), and an optional due date that defaults to today. Tapping the date opens a calendar picker.
- Task cards are Post-It style, cycling automatically through 8 pastel colors.
- Long-press a task card to edit it.

**Shopping** — a single checklist. Add items, check them off, and clear checked items.

## Development

Tooling lives in WSL:

```bash
npm install
npx expo start        # then open in Expo Go on the device
npm run typecheck
```

## Building an APK

Uses EAS (cloud build, no local Android SDK needed):

```bash
npx eas build -p android --profile preview
```

## Running it on your own iOS device

[`docs/ios-device-setup.md`](docs/ios-device-setup.md) covers standing the app
up on an iPhone or iPad under your own Apple Developer account, from a fresh
clone, without going through the App Store.
