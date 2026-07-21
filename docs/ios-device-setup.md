# Running Jodoo on your own iPhone or iPad

This walks through getting Jodoo onto an iOS device you own, signed with your
own Apple Developer account, starting from a fresh clone. Nothing here touches
the App Store, App Store Connect, or TestFlight.

There are two routes, and the first one is free. Read [Which route do you
want](#which-route-do-you-want) before installing anything.

## Which route do you want

**Expo Go** runs Jodoo inside Apple's copy of the Expo Go host app. No Apple
Developer account, no build, no signing, and changes reload as you save them.
The catch is that you are running inside someone else's app container, so the
app has Expo Go's icon and name, it disappears if you delete Expo Go, and
anything requiring a custom native module would not work. For reading the code
and making changes, this is the route you want.

**An ad hoc build** produces a real, standalone Jodoo that installs on your
device like any other app, with its own icon, and keeps working offline and
after reboots. This needs a paid [Apple Developer
Program](https://developer.apple.com/programs) membership, currently 99 USD a
year, because ad hoc provisioning is a paid-account feature. Apple caps ad hoc
distribution at 100 devices per year per account.

If you are unsure, start with Expo Go. You can do the ad hoc build later
without redoing any of it.

## Prerequisites for both routes

- **Node.js** 20.19.4 or newer. SDK 57 will refuse older versions.
- **Git**.
- An **[Expo account](https://expo.dev/signup)**, free.
- The **Expo Go** app from the App Store, if taking the first route.

You do not need Xcode, and you do not need a Mac. Builds happen on Expo's
servers, so Linux and Windows work as well as macOS.

## Get the code running

```bash
git clone https://github.com/joshwg/JoDoo.git
cd JoDoo/app
npm install
npm run typecheck
```

`npm run typecheck` is the only automated check in the project, and a clean run
means your toolchain is set up correctly. There is no test suite.

### Route 1: Expo Go

```bash
npx expo start
```

Scan the QR code with the Camera app on your device. If Expo Go is installed,
the project opens in it. If the QR code sends you to the App Store instead,
that is iOS telling you Expo Go is not installed yet, so install it and scan
again.

Your computer and your device have to be on the same network. If the QR code
resolves but never connects, add `--tunnel` to route through Expo's relay,
which is slower but crosses networks and restrictive Wi-Fi.

If Expo Go reports the project is incompatible with its version, see
[SDK version drift](#sdk-version-drift) below.

That is the whole first route. Everything below is only for the ad hoc build.

## Route 2: an ad hoc build under your Apple account

### Step 1: make the project yours

The repository is configured for its original author's accounts, and three
values in [`app/app.json`](../app/app.json) have to change before you can sign
anything. This is the step people skip, and the errors it produces later are
confusing.

| Field | Why it has to change |
|---|---|
| `expo.ios.bundleIdentifier` | Apple App IDs are globally unique and owned by one team. You cannot register an identifier another team already holds. |
| `expo.android.package` | Same idea on the Android side. Change it for consistency even if you are only building iOS. |
| `expo.owner` | Names the Expo account that owns the project. Leave someone else's here and your builds fail with a permissions error. |

Set the two identifiers to a reverse domain you control, for example
`com.yourname.jodoo`, and set `owner` to your Expo username. Then delete the
whole `expo.extra.eas` block, which pins the project to an EAS project ID that
is not yours:

```json
"extra": {
  "eas": {
    "projectId": "36025335-fcc6-4a9b-9048-c57c7803672c"
  }
}
```

Note that the identifier you choose becomes your app's identity on the device.
Changing it later makes iOS treat the result as a different app rather than an
upgrade.

### Step 2: log in and create your EAS project

```bash
npx eas-cli login
npx eas-cli init
```

`init` writes a fresh `projectId` back into `app.json`, replacing the block you
deleted. If it complains that the slug is taken, change `expo.slug` too.

### Step 3: register your device

```bash
npx eas-cli device:create
```

This prompts for an Apple ID. Your Expo account and your Apple account are
separate systems with no requirement that they match, so enter your own Apple
Developer credentials here regardless of what Expo account you are logged into.
Choose your team when asked.

You will get a URL and QR code. Open that **on the device you are registering**
and install the profile it offers. Then confirm it took:

```bash
npx eas-cli device:list
```

Register every device you want to install on before building. The provisioning
profile bakes in the device list at build time, so a device registered
afterwards cannot install that build. You would need another build, or
`npx eas-cli build:resign`.

### Step 4: build

```bash
npx eas-cli build -p ios --profile device
```

The `device` profile is defined in [`app/eas.json`](../app/eas.json) and sets
`distribution: internal`, which produces an ad hoc build. Do not use
`--profile production`, which has no `distribution` key and therefore defaults
to store distribution and sends you into App Store Connect. Do not use
`--profile preview` either, which sets `ios.simulator` and produces a binary
that only runs in the iOS Simulator.

The build runs on Expo's servers and takes roughly 10 to 20 minutes. You can
close the terminal and check progress on your [EAS
dashboard](https://expo.dev/accounts).

### Step 5: install

EAS prints an install URL when the build finishes. Open it in **Safari on the
target device**. Other browsers will not trigger the install prompt.

The first launch will fail with an untrusted developer message. Approve
yourself once under Settings, General, VPN & Device Management, and it will
launch from then on.

## Troubleshooting

### Bundle identifier is not available

Apple is telling you another team already owns that App ID. You skipped or
partly did [Step 1](#step-1-make-the-project-yours). Pick an identifier under a
domain you control.

### Cannot find module '@expo/config-plugins'

`npm install` did not complete, or something removed the
`@expo/config-plugins` devDependency. It is there deliberately.
`@react-native-community/datetimepicker` requires that package without
declaring it as a dependency, and SDK 57 nests Expo's copy where the plugin
cannot reach it. Reinstall with `npm install`.

Relatedly, `npx expo-doctor` reports that `@expo/config-plugins` "should not be
installed directly" and advises removing it. Do not. Doctor's own message
allows for this case, and removing the package breaks `expo config`,
`expo start`, and every build.

### Couldn't find any teams for the account

No Apple Developer team is linked to your Expo account yet. `device:list` only
reads an existing link and never prompts for a login. Run `device:create`
first, which is the command that asks for Apple credentials.

### SDK version drift

Expo Go supports exactly one SDK version at a time, and the App Store only ever
ships the current one. When Expo Go moves ahead of this project, Expo Go will
refuse to open it and you will need to either upgrade the project or switch to
the ad hoc route. Apple does not permit sideloading older Expo Go builds onto a
physical device, so the workaround available on Android and the iOS Simulator
does not apply here.

The project was on SDK 54 for exactly this reason and had to move to 57. Expect
it to recur.

### App installed but will not open

Almost always the untrusted developer prompt described in [Step
5](#step-5-install).

## Where to go next

[`CLAUDE.md`](../CLAUDE.md) at the repository root covers the architecture,
including how the local SQLite database relates to the optional sync server,
and why sharing is built the way it is. The sync server has its own setup notes
in [`server/README.md`](../server/README.md), and it is entirely optional. Jodoo
works offline with no server configured.
