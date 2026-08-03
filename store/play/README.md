# Google Play store assets

Listing assets for the Jodoo Play Store entry (`com.newleafsoftware.jodoo`).
Nothing here is consumed by a build — these are uploaded by hand in Play Console.

Listing text (short + full description) lives in `listing.md`.

## Where to put screenshots

```
screenshots/phone/            raw device captures - drop new ones here
screenshots/phone-play-ready/ *** UPLOAD THESE *** 1080x1920, generated
screenshots/tablet-7in/       optional - needed for "designed for tablets" badge
screenshots/tablet-10in/      optional - same
graphics/                     feature graphic + 512px icon
```

**Upload from `phone-play-ready/`, not `phone/`.** The raw captures are
877x2048, a 1:2.34 ratio, which breaks Play's rule that the longest side may be
at most twice the shortest. That is not a capture mistake - modern phones are
simply taller than 2:1, so raw captures from this device will always need this
step.

### Regenerating after adding new captures

Drop new captures in `phone/`, then:

```
wsl -e bash -lc '~/.venvs/imaging/bin/python /path/to/pad_screenshots.py \
    ~/projects/Jodoo/store/play/screenshots/phone \
    ~/projects/Jodoo/store/play/screenshots/phone-play-ready'
```

The script scales each image to fit 1080x1920 and pads the sides by replicating
each row's edge pixel outward, so the fill matches the UI at that height instead
of banding one flat colour. Nothing is cropped. It numbers outputs `01-`, `02-`
in filename order, which is the order Play displays them - rename sources to
control it.

Pillow lives in a venv at `~/.venvs/imaging` (Ubuntu's system Python is
PEP 668 managed and refuses direct pip installs). Recreate with:

```
python3 -m venv ~/.venvs/imaging && ~/.venvs/imaging/bin/pip install Pillow
```

## Requirements

**Phone screenshots** (required, minimum 2)

- PNG or JPEG, no alpha channel
- Each side between 320 px and 3840 px
- The longest side may be at most twice the shortest — so anything between
  1:2 and 2:1 is accepted. A straight portrait phone capture is well inside this.
- Use portrait: Jodoo is locked to portrait (`"orientation": "portrait"` in `app.json`)
- Do not add device frames, drop shadows, or marketing text bars. Play renders
  its own framing and Google rejects screenshots that misrepresent the UI.

**Tablet screenshots** (optional, but see note below)

- Same format rules; 7in and 10in each take their own set
- Without these, Play shows a "not designed for tablets" notice to tablet users.
  `supportsTablet` is set for iOS only, so this is a judgement call for Android.

**Feature graphic** (required) -> `graphics/feature-graphic.png` - GENERATED

- Exactly 1024 x 500 px, PNG or JPEG, no alpha
- Shown at the top of the listing and in promotional placements
- Keep text well inside the centre; edges get cropped in some placements

**App icon** (required) -> `graphics/icon-512.png` - GENERATED

- Exactly 512 x 512 px, 32-bit PNG **with** alpha, max 1024 KB
- A separate upload from the in-app launcher icon, though both derive from
  `app/assets/icon.png` (which is conveniently already 1024x1024 RGBA)

### Regenerating the graphics

```
wsl -e bash -lc 'cd ~/projects/Jodoo/store/play && \
    ~/.venvs/imaging/bin/python make_graphics.py ~/projects/Jodoo/app/assets graphics'
```

`make_graphics.py` samples the brand colours straight out of `icon.png`
(`#1a237e` dark, `#1a348f` light, `#4caf50` check) so the listing cannot drift
from the app. Edit `WORDMARK` / `TAGLINE` / `SUBLINE` at the top of the script
to change the feature-graphic copy.

Note it composites `android-icon-foreground.png` (the mark on transparency),
not `icon.png`. `icon.png` carries its own blue diagonal, which collides with
the graphic's backdrop and reads as a stray wedge rather than an app tile.

## Checking a file before upload

```
wsl -e bash -lc 'cd /path/to/store/play && file screenshots/phone/*.png'
```

`identify` (ImageMagick) gives exact dimensions if available.

## Content notes

Screenshots must show the real app. Since Jodoo has no account and no server by
default, avoid captures that imply a hosted service. If a screenshot shows the
sharing screen, make sure any server address or share key in it is fake or
redacted — a real share key in a public listing grants access to that list.
