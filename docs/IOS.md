# iPhone app (Apple Health without Shortcuts)

A web app cannot read Apple Health: Apple reserves HealthKit for installed apps. The `ios/` folder is the same Shred app wrapped in a native shell (Capacitor 8) that reads Health directly with `@capgo/capacitor-health`:

- steps, walking and running distance, active and resting energy, exercise minutes;
- sleep (time asleep, filed under the morning you wake up), resting heart rate, HRV;
- workouts from the Apple Watch (runs, rides, swims, strength), imported like Strava activities. A watch workout of the same sport as the day's session ticks that session off.

Everything else (account, encrypted backup, club, Strava) talks to your Worker, exactly like the web app.

## What you need

- A Mac with Xcode 16 or later.
- An Apple ID. With a free account the app has to be reinstalled every 7 days; the Apple Developer Program (99 €/year) removes that limit and allows TestFlight for friends. If Xcode refuses the HealthKit capability with a free account, the program is required.
- Node 22.

## Build and install

```bash
git pull
npm ci
cp .env.native.example .env.native        # then set VITE_API_BASE to your Worker address
npm run build:ios                         # builds dist-native and copies it into ios/
npm run ios                               # opens the project in Xcode
```

In Xcode:

1. Select the **App** target, **Signing & Capabilities**, choose your team. Change the bundle identifier (`fr.shred.app`) if Xcode says it is taken.
2. Check that **HealthKit** is listed under capabilities (the entitlement is already in `ios/App/App/App.entitlements`). If it is missing, click **+ Capability**, then **HealthKit**.
3. Plug in the iPhone, pick it as the destination, press Run. The first time, allow the developer profile on the phone: Settings, General, VPN and device management.

In the app: Settings, Connections, Apple Santé, **Autoriser et synchroniser**. iOS shows its Health permission sheet once; after that the app reads Health every time it opens. Permissions can be changed later in the iPhone Settings, Health, Data access and devices, Shred.

## After an update

```bash
git pull && npm ci && npm run build:ios
```

then Run again from Xcode. The web code is copied into the app at build time, so an update of the web app does not reach the iPhone app until you rebuild it.

## Known limits

- Reminders and the rest-timer notification use Web Push, which does not exist inside an iOS app. They keep working in the web app; in the iPhone app they would need Apple push notifications (APNs), not wired yet.
- Android: the same plugin reads Health Connect. `npx cap add android` creates the project; it has not been tested.
