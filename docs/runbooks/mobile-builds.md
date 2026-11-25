# Mobile store builds on GitHub Actions

Two workflows build the Tikèm store binaries with `eas build --local` on GitHub runners.
Local builds use **no EAS cloud build quota**; EAS still supplies the signing credentials,
the build number (remote, auto-incremented) and the production `EXPO_PUBLIC_*` env.
Ported from Tikra's working workflows.

| Workflow | Runner | Output artifact | Optional submit |
|---|---|---|---|
| `.github/workflows/ios-build.yml` | `macos-15` (Xcode 26), 120 min max | `tikem-ios-ipa` → `tikem.ipa` | App Store Connect / TestFlight |
| `.github/workflows/android-build.yml` | `ubuntu-latest`, 90 min max | `tikem-android-aab` → `tikem.aab` | Play **internal** testing track |

macOS minutes bill at 10x on a private repo, so both run **on demand only** (no PR or main triggers).

## One-time setup

1. Create a token: expo.dev → Account settings → **Access tokens** → Create (account `edlight`,
   which owns the project). Then:
   ```sh
   gh secret set EXPO_TOKEN          # paste the token when prompted
   ```
2. Only if you want CI to submit (optional):
   - **iOS**: nothing, if the App Store Connect API key is already stored on EAS
     (`cd mobile && eas credentials -p ios` → production → App Store Connect API Key). Otherwise
     set all three:
     ```sh
     gh secret set ASC_API_KEY_P8 < ~/AuthKey_XA7DX3A8Z8.p8
     gh secret set ASC_KEY_ID        # XA7DX3A8Z8
     gh secret set ASC_ISSUER_ID     # App Store Connect → Users and Access → Integrations
     ```
   - **Android**: the Play service account key that `eas.json` reads as
     `./google-play-service-account.json` (gitignored; a copy lives in `mobile/` on the owner's Mac):
     ```sh
     gh secret set GOOGLE_PLAY_SERVICE_ACCOUNT_JSON < mobile/google-play-service-account.json
     ```
     Play only accepts API uploads after the first AAB was uploaded by hand
     (`store/google-play/PLAY_CONSOLE_STEPS.md`).

## Run a build

- **GitHub UI**: Actions → *iOS build* or *Android build* → **Run workflow** → pick the branch
  (usually `main`) → tick **submit** if the binary should go straight to TestFlight / Play internal.
- **CLI**:
  ```sh
  gh workflow run ios-build.yml --ref main                       # build only
  gh workflow run ios-build.yml --ref main -f submit=true        # build + TestFlight
  gh workflow run android-build.yml --ref main -f submit=true    # build + Play internal
  gh run watch                                                   # follow it
  gh run download <run-id> -n tikem-ios-ipa                      # fetch the IPA
  ```
- **Push**: `git push origin main:build-ios` (or `build-android`) builds that commit. Push
  triggers never submit.

Each build checks the JS bundle for the `event-haiti` Firebase project and `www.tikem.co` before
uploading the artifact, so a build that missed the EAS production env fails instead of shipping
a binary that can't sign anyone in.

To submit an artifact later by hand: `cd mobile && eas submit -p ios --path tikem.ipa`
(or `eas submit -p android --profile internal --path tikem.aab`).

## Versions

- **Build number / versionCode**: automatic. `appVersionSource: remote` + `autoIncrement` in
  the production profile, so EAS bumps it on every build (local or cloud). Nothing to edit.
- **Marketing version** (`1.0.4`): `expo.version` in `mobile/app.json`. Bump it for every store
  release that changes native code. `runtimeVersion` follows it (`policy: appVersion`), so a new
  version gets its own OTA runtime: add the previous version to `LEGACY_RUNTIMES` in
  `scripts/publish-ota.sh` once the new build is live.
- **Env**: CI reads `EXPO_PUBLIC_*` only from the EAS **production** environment plus the
  `env` block in `eas.json` (`.env` is gitignored and never on the runner). After adding an
  `EXPO_PUBLIC_*` var to `mobile/.env`, also run `eas env:create`/`eas env:push production`.

## Troubleshooting

- *"Add the EXPO_TOKEN repository secret"*: step 1 above.
- Android runs out of disk: the free-disk step must stay **before** setup-node / setup-java.
- Xcode: the iOS job picks the newest `Xcode_26*` on the runner; the log prints the version.
