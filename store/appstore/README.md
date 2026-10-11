# App Store release assets

Listing assets for the Jodoo App Store entry (`com.newleafsoftware.jodoo`,
ASC app ID 6813705401). Nothing here is consumed by a build — these are
entered by hand in App Store Connect. Listing text lives in `listing.md`;
Apple-sized screenshots in `screenshots/iphone-6.7/` (regenerate with
`pad_screenshots.py`, which reads the raw captures from
`../play/screenshots/phone/`).

Why this exists: TestFlight builds expire after 90 days, forcing a re-build
every quarter. An App Store release never expires and updates like any
normal app. The same uploaded binary serves both: whatever build is in ASC
can be submitted for review, no separate build needed.

## Release checklist (all in https://appstoreconnect.apple.com, app 6813705401)

1. **App Information**: rename the app (see `listing.md` — "Jodoo (d599da)"
   is the placeholder ASC generated because "Jodoo" was taken), set
   category, privacy policy URL.
2. **App Privacy**: answer the questionnaire — "Data Not Collected"
   (reasoning in `listing.md`).
3. **Pricing and Availability**: Free, all countries (or trim).
4. **The version page** (e.g. "1.2.5 Prepare for Submission"): upload
   screenshots, paste description / keywords / subtitle / support URL,
   add "What's New" text, **select the build** already uploaded via EAS,
   paste the App Review notes from `listing.md`, set age rating.
5. **Submit for Review**. First-app reviews typically take 1–3 days.
   Rejections come with a message in ASC; they are normal for a first
   submission and almost always fixable with a reply or metadata tweak.
6. After approval, release (manual or automatic per the option chosen on
   the version page). From then on each `eas build -p ios --profile
   production --auto-submit` upload can be promoted to the store by
   creating a new version in ASC, selecting the new build, and submitting.
