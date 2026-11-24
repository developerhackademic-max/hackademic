# Hackademic — full-stack development prototype

A runnable Node.js multi-role training and company operations platform. The public landing page preserves the supplied Hackademic HTML reference, teal/blue theme and CSS animations. SQLite remains the current application runtime; Firebase Auth and Firestore are configured as an emulator-first migration foundation, not yet as the API's storage backend.

## Quick start

Requires **Node.js 22.5+** (Node's built-in `node:sqlite`).

```bash
cd hackademic-platform
npm run demo   # creates clearly labelled demo data and users; run only on a local test instance
npm start
```

### Firebase emulator migration foundation

Install the declared dependencies with `npm install`. The Firebase Auth and Firestore emulators also require Java (use a current supported JDK). The read-only SQLite importer requires Node.js 22.13+; the existing website itself still supports Node.js 22.5+. Start both local emulators in one terminal:

```bash
npm run emulators
```

In another terminal, copy the existing SQLite records into the emulator:

```powershell
$env:FIREBASE_PROJECT_ID="demo-hackademic-local"
$env:FIREBASE_AUTH_EMULATOR_HOST="127.0.0.1:9099"
$env:FIRESTORE_EMULATOR_HOST="127.0.0.1:8080"
npm run migrate:firebase
```

Set `DB_PATH` to select a different source database. The importer opens SQLite read-only and upserts records into Firestore collections named after their SQLite tables, retaining numeric IDs as document IDs (and using `user_id_lesson_id` for lesson progress). Foreign-key values remain unchanged. It deliberately does not import login sessions; user records have password hashes/salts stripped, and Firebase Auth accounts are created without an imported password, marked `password_reset_required`, and assigned their existing role as a custom claim. Re-running is safe for Firestore data and does not change the source database. The importer rejects non-emulator project IDs and refuses to run unless both emulator host variables are set.

The emulator UI is at **http://127.0.0.1:4000/**. Do not treat emulator data as production data or use production credentials with this workflow. Firebase is not wired to the website API yet: the current server and browser login continue to use SQLite until the API's data access, cookie/CSRF authentication, and password-reset flows are migrated and tested together. No production migration or deployment is configured.

Open **http://localhost:3000/** (public landing page), **/careers.html** (job applications), **/portal.html** (secure role dashboards), and **/certificate.html** (certificate verification).

Demo accounts (all use password **HackademicDemo!2026** unless `DEMO_PASSWORD` is set before seeding):

- `admin@hackademic.demo` — administrator
- `hr@hackademic.demo` — HR
- `instructor@hackademic.demo` — instructor
- `student@hackademic.demo` — student
- `team@hackademic.demo` — employee

Demo certificate ID for the public verification page: `HA-2026-001` (created by `npm run demo`).

`npm run demo` only seeds an empty user database. **Never run the demo seeder in production.** Delete the local `data/hackademic.db*` files to reset the local prototype.

## Implemented workflows

- Public animated landing page, persistent enquiry submission and job listings/application form
- Public certificate lookup by certificate number
- Role-based login with HttpOnly SameSite session cookie, scrypt password hashing, CSRF header, basic request throttling and server-side role authorization
- Manager workspace: website queries, student accounts and enrollments, employees, course/service creation, batch creation, lesson publishing with hosted recordings or uploaded videos, and employee leave approvals
- Admin workspace sidebar: employees, task assignment and tracking, per-page SEO controls, blog publishing, and employee leave approvals
- Employee workspace: view assigned tasks, update progress, and mark work completed; in-app reminders highlight overdue tasks and deadlines within three days
- Employee accounts are created with an initial password of at least 12 characters in the Manager or Admin employee directory
- Student LMS: enrolled courses, lessons, completion tracking, quizzes with server-side scoring, assignment submissions, support tickets
- Instructor: lesson publishing and video uploads for assigned courses, assignment submission review and grading
- HR is the internal role name for the Manager workspace
- Uploaded lesson videos are stored outside the public web root, limited to 500 MB each, and streamed only to authorized staff or enrolled students
- SQLite persistence, parameterized SQL, output escaping in portal UI, basic audit logging
- Firebase Emulator Suite configuration and a read-only, repeatable SQLite-to-Firestore/Auth importer (migration foundation only)

## Before going live

This is a **development MVP, not a production-ready enterprise LMS**. Before using Firebase for the live application, migrate every API query and write to Firestore, replace SQLite session authentication with Firebase ID-token verification and a compatible CSRF/cookie strategy, implement a user-facing reset-required/password-reset flow, and validate authorization and behavior against the emulators. You must also add email verification, robust login-specific rate limiting, persistent audit/observability, backup/restore, privacy and retention controls, fine-grained permissions, payment gateway and webhook verification, certificate issuance workflow (the public lookup verifies records already issued and stored), cloud video/storage integration, live classes, attendance, automated messaging, production-quality input validation, accessibility QA, security testing, and a deployment/SSL setup. Public reference-page statistics, reviews, prices and course descriptions are illustrative until approved.

The website demo uses SQLite and Node's built-in HTTP server. Local video uploads use disk storage; configure cloud storage before production use. SEO controls update metadata served by this app and its sitemap/robots files, but do not provide search-rank tracking or analytics integrations. Set `NODE_ENV=production` only behind HTTPS with trusted reverse-proxy configuration; secure cookies require HTTPS. Use a fresh production database with no demo users.

## Layout

- `server.js` — HTTP server, API endpoints, authentication and authorization
- `db.js` — SQLite schema, seed course content and optional demo accounts
- `firebase.json`, `firestore.rules` — local Firebase emulator configuration and deny-by-default client rules
- `scripts/migrate-to-firebase.js` — read-only SQLite to emulator migration importer
- `public/index.html` — animated Hackademic reference-based landing page
- `public/certificate.html`, `public/certificate-verify.js` — public certificate verification page
- `public/portal.html`, `portal.css`, `portal.js` — multi-role dashboard
- `public/careers.html`, `careers.js` — jobs and application page
- `public/public-api.js` — public enquiry form API integration
- `tests/` — automated API smoke tests
