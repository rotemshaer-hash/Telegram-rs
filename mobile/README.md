# Drushe mobile wrapper

This is a thin native wrapper (Capacitor) around the live web app at
https://kidemy-app.netlify.app — it does **not** contain a copy of the app's
code. `capacitor.config.json`'s `server.url` points at the live site, so the
native app always loads whatever is currently deployed there.

**Practical effect:** every future change to `index.html` (features, fixes,
copy) that gets pushed to `main` and deployed to Netlify shows up instantly
in the native app too, with zero app-store resubmission. Resubmission is
only needed for changes to the native shell itself — icon, app name, native
permissions, or the wrapper's own version.

## What's done

- Capacitor project set up for both platforms (`android/`, `ios/`).
- App name "Drushe" set in both platforms.
- App icon generated from the real Drushe wordmark logo on the brand
  gradient, at every required size for both platforms (`generate-icons.js`
  — rerun it if the design should change).
- Splash screen generated to match (`generate-splash.js`).
- Two GitHub Actions workflows added, matching the existing deploy
  workflow style:
  - `build-android.yml` — builds a debug APK on every push touching
    `mobile/`, no signing required. Download it from the workflow run's
    artifacts to install on a real Android device for testing.
  - `build-ios.yml` — builds for the iOS Simulator only (no signing
    required), just to confirm the Xcode project compiles correctly.

## What's NOT done yet — needs you directly

None of this can be done by an AI assistant; these are your accounts,
your payment, your legal identity.

1. **Google Play Console account** ($25 one-time) — https://play.google.com/console
2. **Apple Developer Program** ($99/year) — https://developer.apple.com/programs
   Required even to produce a real installable iOS build (not just the
   simulator build the CI currently produces).
3. **Android signing key** — once you're ready for a real release build
   (not just the debug APK the CI currently produces), a keystore needs to
   be generated and kept safe *forever* — losing it means never being able
   to update the app under the same identity again. This should be
   generated once you have your Play Console account, and stored as a
   GitHub Actions secret, never committed to the repo.
4. **iOS signing certificate + provisioning profile** — generated through
   your Apple Developer account, needed before `build-ios.yml` can produce
   a real device / App Store build instead of just a simulator build.
5. **Store listings** — screenshots, description, age rating questionnaire
   (this one needs real care — Drushe is a children's platform, and both
   stores have extra rules here worth reading carefully rather than
   rushing), privacy policy URL (already have `/privacy.html`) and terms
   URL (already have `/terms.html`).
6. **Subscription payment policy decision** — both stores require
   in-app digital subscription purchases to go through their own billing
   (with their cut), unless the purchase happens outside the app. Needs a
   decision before submission, not after.

## Regenerating icons/splash after a design change

```
cd mobile
node generate-icons.js
node generate-splash.js
```
