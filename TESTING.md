# Run everything on your PC

Prereqs: Node 22, Postgres 16, Redis, Android Studio (emulator) or a phone with Expo Go/dev build, Chrome.

## 1. Backend (needs Postgres + Redis running)
cd backend && cp .env.example .env && npm ci && npm test            # 260 tests
AUTH_RATE_LIMIT_MAX=100000 npm start                                 # :4000, keep running

## 2. Web (e2e needs backend above)
cd portal && npm ci && npx playwright install chromium && npx vite --port 5173 &
npx playwright test                                                   # 23 specs

## 3. Desktop installers (build on each OS; set API URL first)
cd portal && cp .env.production.example .env.production   # edit VITE_API_BASE
npm run electron:build:win   # or :mac / :linux  -> portal/release/

## 4. Android
cd mobile && npm ci && npx eslint src App.js --max-warnings=0
npx expo start --android      # emulator uses http://10.0.2.2:4000/api
npx eas build -p android --profile preview   # installable APK (needs `eas login`; edit API URL in eas.json)

## Manual checks worth doing on a real device
- Airplane mode: send chat message -> shows "Waiting to send" -> delivered once on reconnect
- Open two devices: typing, ticks, reactions, replies, attachments, disappearing messages
- Account -> Linked devices: sign in a second device with a code; sign it out remotely
