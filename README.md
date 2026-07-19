# Jodoo

A simple Android to-do and shopping list app. No accounts, no passwords — everything is stored locally on the device in SQLite.

Built with Expo (React Native + TypeScript), following the same WSL + EAS workflow as `flightscan/apps/mobile`.

## Sections

**To Do** — a set of to-do lists, one per tab.

- Tap the `+` tab to add a list. New lists are named `To Do N`, where N is the smallest positive integer that doesn't collide with an existing tab name.
- Long-press a tab to rename or delete the list. Drag a tab by its handle (⋮) to reorder the lists; the strip auto-scrolls if you drag near the screen edge.
- Tap the `+` button at the top of a list to add a task.
- Tasks have a bold title, an optional description (first line visible; tap the card to expand), and an optional due date that defaults to today. Tapping the date opens a calendar picker.
- Task cards are Post-It style, cycling automatically through 8 pastel colors.
- Tap a task once to expand/collapse its description. Double-tap it, or tap the pencil (✎) icon, to open the editor.
- Drag the handle (☰) on the right of a card to move or reorder a task:
  - Drag up and drop onto a tab to move the task to that list. The tab strip enlarges and highlights the tab you're hovering over, and auto-scrolls if you drag near the left/right edge of the screen so off-screen tabs stay reachable.
  - Drop it between two other cards in the same list to reorder it there instead.

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
