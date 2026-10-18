# AveriLabRN — the truth lab's React Native app

The third lab app (docs/plans/2026-10-15-ground-truth-lab-app.md, round 7): React Native's own controls, which the
native lab apps (`fixtures/apps/ios`, SwiftUI; `fixtures/apps/android`, Compose) cannot build. It builds the
`react-native` family of the cell catalog alone (`fixtures/apps/cells/react-native.json`;
`scripts/truth/schema.ts#appOf`) — first `rn-field`, calibration.json #18's field half: an RN `TextInput` under its
floating label, the field with an icon, a multiline field.

React Native 0.88.0 from the community CLI's bare template (`@react-native-community/cli@20.2.0 init`), the new
architecture, Hermes; no Expo. Bundle `dev.averi.lab.rn` on iOS, package `dev.averi.lab.rn` on Android — beside the
native lab app (`dev.averi.lab`), never in its place.

## The lab's contract

The same as the native apps' (`scripts/truth/schema.ts`): one cell per launch, chosen by the launch argument
`-cell <id>` (iOS) or the intent extra `cell` (Android), handed to `App.tsx` as the root's initial property; the state
file `lab-state.json` (iOS: the data container's `Documents/`; Android: `files/`, read with `run-as`), whose frames are
in the tree's units (points on iOS, screen pixels on Android) and whose `touch` events are every touch the app's
windows receive before anything handles it. The JS model (`src/lab.ts`) owns the state; a small native module
(`ios/AveriLabRN/LabStateFile.m`, `android/…/LabStateFile.kt`) owns the file and the touch log and writes the two
merged. The catalog is the generated `../cells.json`, read at bundle time (`metro.config.js` watches `fixtures/apps`).

The harness drives it with `--app react-native` (`scripts/truth/lab-device.ts#LAB_APP`): its captures go to runs of
their own, `tests/fixtures/truth/ios-rn-iphone17-ios27` and `android-rn-averi_lab-api33` (manifest `app`
`AveriLabRN`).

## Build (outside the sandbox: network installs and the builds)

```sh
cd fixtures/apps/rn
npm install                       # node_modules here, not the repo root's
(cd ios && pod install)           # Pods, not committed

# iOS: a Release build for the simulator — the JS bundled in, no Metro needed
(cd ios && xcodebuild -workspace AveriLabRN.xcworkspace -scheme AveriLabRN -configuration Release \
  -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' -derivedDataPath build/dd \
  CODE_SIGNING_ALLOWED=NO build)
xcrun simctl install 3AB1E82E-47C1-4BEF-9F89-1FF62DBBC348 \
  ios/build/dd/Build/Products/Release-iphonesimulator/AveriLabRN.app

# Android: the release variant (the JS bundled in), debuggable so run-as reads the state file; arm64-v8a only
(cd android && JAVA_HOME=~/Library/Java/JavaVirtualMachines/azul-17.0.19/Contents/Home ./gradlew assembleRelease)
adb -s emulator-5554 install -r android/app/build/outputs/apk/release/app-release.apk
```

After a catalog change (`node --import tsx scripts/truth/catalog.ts`), rebuild both: the catalog is in the bundle.

## Run

```sh
xcrun simctl launch 3AB1E82E-47C1-4BEF-9F89-1FF62DBBC348 dev.averi.lab.rn -cell rn-field
adb -s emulator-5554 shell am start -n dev.averi.lab.rn/.MainActivity --es cell rn-field

# capture (repo root): the lab simulator and the averi_lab AVD only, one at a time
node --import tsx scripts/truth/capture.ts --udid 3AB1E82E-47C1-4BEF-9F89-1FF62DBBC348 --app react-native \
  --family react-native --out tests/fixtures/truth/ios-rn-iphone17-ios27
node --import tsx scripts/truth/capture-android.ts --serial emulator-5554 --app react-native \
  --family react-native --out tests/fixtures/truth/android-rn-averi_lab-api33

# live golden: the RN forms cases (rn1–rn6) and the visibility cases of its truth
node --import tsx scripts/truth/live.ts --udid 3AB1E82E-47C1-4BEF-9F89-1FF62DBBC348 --app react-native \
  --groups forms,visibility --record docs/truth/live-records/<file>.json
node --import tsx scripts/truth/live.ts --serial emulator-5554 --app react-native --groups forms,visibility \
  --record docs/truth/live-records/<file>.json
```

`node_modules`, `ios/Pods`, `ios/build`, `android/build`, `android/app/build` and the JS bundle stay out of git
(`.gitignore`).
