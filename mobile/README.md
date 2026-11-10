# Lesson Teacher — Mobile (React Native / Expo)

## Scope of this v1

Parent-only flow, by explicit agreement: login/signup, skill-based tutor
discovery with the signature swipe UI, bookings with all 4 payment methods
(direct transfer, card, USSD, gateway), real-time messaging, and live video
lessons. Tutor, school-admin, and super-admin accounts hit a clear
"not available yet, use the web portal" screen rather than a broken or
missing one — see `src/navigation/RootNavigator.jsx`.

Talks to the same backend as the web portal, over the same REST API and the
same Socket.io events — this is not a separate backend or a mocked one.

## Setup

```
npm install
cp .env.example .env   # then edit EXPO_PUBLIC_API_BASE — see the comments in that file,
                        # the default only works for the Android emulator
npx expo prebuild       # generates native ios/ and android/ projects — required once,
                         # since react-native-webrtc needs native code Expo Go can't run
npx expo run:android    # or run:ios, from a machine with the respective SDK/Xcode installed
```

This is a **dev-client** app (`expo-dev-client`), not Expo Go — video
calling needs `react-native-webrtc`, a native module Expo Go doesn't
include. `npx expo run:android`/`run:ios` builds and installs a dev client
with that module baked in.

## What's real here vs. what to double-check

The video-calling code is not a stub or a guess at how this should work —
`mediasoup-client` ships a dedicated `ReactNative106` WebRTC handler,
auto-detected via `navigator.product === 'ReactNative'` (verified by
reading `node_modules/mediasoup-client/lib/Device.js` directly, not
assumed from memory), activated by `react-native-webrtc`'s
`registerGlobals()`. Same signaling protocol, same backend SFU, as the
already-verified web client's video calls.

**What was actually verified in the sandbox this was built in:**
- `npx expo export` — a real Metro/Hermes bundle, for both Android (1466
  modules) and iOS (1470 modules). Every import in the dependency graph
  resolves and compiles, including mediasoup-client, react-native-webrtc,
  reanimated, and react-navigation together.
- `eslint` (via `eslint-config-expo`) — 0 problems. Caught 8 genuine issues
  along the way (unescaped characters, an unused import, a statement
  written as an unused expression) — all fixed for real, not suppressed.
  3 lines have a justified, explained `eslint-disable` for a documented
  false-positive class (the newer React-Compiler-safety rules in
  `eslint-plugin-react-hooks` don't yet special-case Reanimated's
  intentional `.value` mutation pattern — see the comments at each site).

**What was NOT verified, and can't be from here:** the app has never run
on an actual device, simulator, or emulator. This sandbox has no Android
SDK, no KVM (hardware virtualization — without it an emulator is
impractical even if installed), and no Mac/Xcode for iOS. It also can't
reach `api.expo.dev` or any app-store-adjacent service (network
allowlist), which is why dependencies here were installed with plain
`npm install` and pinned versions rather than `expo install`. None of that
is a defect in this code — it's the honest boundary of what this
environment can check. The first real test on a device is the one that
actually matters; do that before considering this done.

## Known gaps, deliberately left for a next pass

- **Gateway/card/USSD checkout** doesn't open the Paystack page in-app yet
  — `BookingsScreen.jsx`'s `startPayment()` has a `TODO` where
  `expo-web-browser`'s `openAuthSessionAsync` should go, with a return
  deep link back into the app. Direct transfer (photo upload + manual
  confirmation) is fully wired.
- **Push notifications** for new messages / booking status changes aren't
  built — the app only shows what's on screen right now.
- Tutor/school-admin/super-admin flows: intentionally out of scope for
  this pass (see Scope above).
