# Hackademic

Hackademic is a static public website with a Firebase-backed Node.js API for authentication, learning workflows, public forms, employee operations, and admin/manager tools. The UI remains under `public/`; the same API handler runs in the local server and as a Vercel serverless function.

## Local emulator setup

Requires Node.js 22.13+ and Java 21+ for Firebase emulators.

1. Install dependencies and copy the local environment template:

   ```powershell
   npm.cmd install
   Copy-Item .env.example .env
   ```

2. Start Auth and Firestore emulators in one terminal:

   ```powershell
   npm.cmd run emulators
   ```

3. In a second terminal, set emulator-only migration variables and import the retained SQLite backup:

   ```powershell
   $env:FIREBASE_PROJECT_ID="demo-hackademic-local"
   $env:FIREBASE_AUTH_EMULATOR_HOST="127.0.0.1:9099"
   $env:FIRESTORE_EMULATOR_HOST="127.0.0.1:8080"
   npm.cmd run migrate:firebase
   ```

4. Start the website:

   ```powershell
   npm.cmd start
   ```

Open `http://127.0.0.1:3000/`, `/portal.html`, `/careers.html`, or `/certificate.html`. The local server reads `.env` if present. Emulator data is separate from production and may be reset at any time.

The importer reads `data/hackademic-before-firebase-20261124.db` in read-only mode, writes SQLite tables as Firestore collections, and preserves their IDs. Legacy `sessions` are excluded. Existing Node scrypt hashes are incompatible with Firebase Authentication, so imported accounts have no password until the user completes password reset. Password hashes and salts are stripped from Firestore user records. No production Firebase project is targeted by the migration or test scripts.

## Tests

Run unit tests:

```powershell
npm.cmd test
```

With Auth and Firestore emulators running and the environment variables above set, run the migration and API integration suite:

```powershell
$env:FIREBASE_WEB_API_KEY="fake-api-key"
$env:PUBLIC_APP_ORIGIN="http://127.0.0.1:3000"
npm.cmd run test:firebase
```

The emulator suite imports the ignored backup, exercises password reset and login, and tests Firestore-backed forms, role permissions, course progress, assignments, and employee tasks. Google Drive requests are covered with mocked API responses; emulator tests never call Google or Firebase production services. Emulator UI: `http://127.0.0.1:4000/`.

## Vercel configuration

Import this repository with the **repository root** as the Vercel project root. `vercel.json` publishes `public/` and routes `api/[...path].js` as a Node serverless function. Configure these environment variables in Vercel's encrypted settings:

- `FIREBASE_PROJECT_ID` — the intended Firebase project ID.
- `FIREBASE_WEB_API_KEY`, `FIREBASE_AUTH_DOMAIN`, and `FIREBASE_WEB_APP_ID` — public Firebase Web App configuration used by client Authentication.
- `FIREBASE_SERVICE_ACCOUNT_JSON` — service-account JSON for the server-side Firebase Admin SDK; grant only required Auth and Firestore permissions.
- `PUBLIC_APP_ORIGIN` — the canonical HTTPS origin used for reset links; do not derive this from request headers.
- `NODE_ENV=production` — enables secure session cookies.
- `GOOGLE_DRIVE_OWNER_EMAIL`, `GOOGLE_DRIVE_CLIENT_ID`, `GOOGLE_DRIVE_CLIENT_SECRET`, and `GOOGLE_DRIVE_REFRESH_TOKEN` — server-only credentials for the admin-owned Google Drive account. Authorize only the `drive.file` scope.
- `GOOGLE_PICKER_API_KEY` and `GOOGLE_CLOUD_PROJECT_NUMBER` — Picker configuration; restrict the API key to the approved site origin.

The app links existing student Firebase accounts to Google only when both verified email addresses match. Admins must register each course folder before approving an enrollment. Drive permissions are direct `user`/`reader` grants with an expiry of at most one year; cancellation removes the stored permission ID and verifies it is absent. Never enable public or domain-wide access. Firestore client rules remain deny-by-default; enrollment and permission records are server-managed.

No Drive credentials, cloud resources, Vercel settings, billing plans, DNS, production data, or deployment were changed for this local implementation. Google OAuth provider setup, Drive OAuth consent/refresh-token creation, staging configuration, and any deployment require separate approval.

## Runtime and migration notes

- `api/[...path].js` contains the Firebase-backed API, and `api/firebase-runtime.js` provides Firebase Auth sessions, CSRF checks, and reset support.
- `api/google-drive.js` implements the server-side `drive.file` operations; only a short-lived access token for Google Picker is returned to an authenticated admin.
- `api/google-identity.js` enforces verified, matching Firebase and linked Google account emails.
- `api/firestore-store.js` implements Firestore document access and ID allocation.
- `server.js` serves the static website locally and forwards API requests to the same serverless handler; it no longer opens SQLite.
- `db.js` and `scripts/demo.js` remain for legacy backup/import preparation only. `npm run demo` seeds a local SQLite source database; it does not seed the live website.
- The SQLite backup is retained at `data/hackademic-before-firebase-20261124.db` and is Git-ignored. Do not delete it.
- Admin-managed SEO records are stored in Firestore. The deployed static HTML still ships its checked-in metadata; dynamic per-page metadata rendering and sitemap/robots rewrites need verification before production.
