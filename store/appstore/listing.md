# App Store listing text

Adapted from `../play/listing.md`; character counts verified against Apple's
limits. Paste as plain text in App Store Connect.

## App name (30 max) — must be unique across the whole App Store

"Jodoo" is taken (ASC auto-named the record "Jodoo (d599da)"). Rename in
App Store Connect → App Information → Name. Candidates, pick one:

```
JoDoo Lists
```

```
JoDoo — To-Do & Shopping
```

The name under the icon on the phone stays "Jodoo" regardless (it comes from
the app binary, not the store listing).

## Subtitle (30 max) — shown under the name in search

**A — 29 chars**

```
Offline to-do & shopping list
```

**B — 27 chars**

```
Private lists. No account.
```

## Keywords (100 max, comma-separated, not shown to users) — 97 chars

```
todo,to-do,task,shopping,grocery,list,checklist,offline,private,no account,shared list,household
```

## Description (4000 max)

Same text as the Play full description (`../play/listing.md`) — it contains
nothing Android-specific except the final permission paragraph. Replace that
paragraph (which names Android's INTERNET permission) with:

```
JoDoo asks for no access to your contacts, location, microphone, photos, or files. The camera is used only if you choose to scan a QR code to join a shared list, and only while you are scanning.
```

## Other fields

- **Privacy policy URL:** `https://newleafsoftware.com/jodoo-privacy.php`
- **Support URL:** `https://newleafsoftware.com` (any page that lets a user reach you)
- **Category:** Productivity
- **Price:** Free
- **App Privacy questionnaire:** "Data Not Collected" (same reasoning as
  Play's Data safety: shared lists live on a server the *user* runs, not one
  New Leaf operates — see memory note `no-public-jodoo-server`. If New Leaf
  ever hosts a server, this answer and the website copy change together.)
- **Age rating questionnaire:** all "No" → 4+.
- **Export compliance:** already answered in the binary
  (`ITSAppUsesNonExemptEncryption: false` in app.json), so ASC won't ask per-build.

## App Review notes (paste into "Notes" in the review section)

```
JoDoo is a fully offline list app: no account, no sign-in, every feature
works without a network connection. Simply create lists, tasks and shopping
items to exercise the app.

The optional "share list" feature requires a self-hosted sync server that
the user runs themselves (the server is open source; New Leaf Software does
not operate one). Without a server configured the sharing menu items simply
explain this. This is disclosed in the app description and privacy policy.
No demo account exists because there are no accounts.
```

## Screenshots

`screenshots/iphone-6.7/` — 1290x2796, generated from the Play captures by
`pad_screenshots.py` (see header comment). Upload to the iPhone 6.7" slot;
Apple reuses them for smaller sizes. If review ever objects that the captures
show a non-iOS status bar, retake them on the iPhone running the TestFlight
build and re-run the script on the new captures.
