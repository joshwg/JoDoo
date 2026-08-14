# Play Store release notes

One section per release, newest first. The fenced block is what gets pasted
into Play Console (plain text only - no markdown or HTML renders there;
bullets are literal characters). Hard limit: 500 characters per language.
The `<en-US>` tags are only needed for the multi-language editor or API
uploads; when typing into the single default-language box, paste just the
lines between them.

## 1.2.3

```
<en-US>
• Multiple shopping lists! Tabs to rename, reorder, and swipe between lists - and share each one separately
• Share a list by link or QR code - the other person just taps or scans to join
• Set up a new device instantly by scanning a Server Setup QR in Server Settings
• Share keys now work from either section - lists land in the right place automatically
• Security updates and bug fixes
</en-US>
```

Full developer changelog for this release: multi-list shopping with per-list
sharing (legacy single shopping list migrates on first launch), kind-agnostic
join, share links with the server's unauthenticated /join landing page and
jodoo:// deep link, QR generate/scan for lists and server setup (new native
modules: expo-camera, react-native-svg, react-native-qrcode-svg - hence the
new camera permission), npm uuid override + Go 1.26.5 toolchain security
fixes.
