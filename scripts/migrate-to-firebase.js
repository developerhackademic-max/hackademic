'use strict';

const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const BATCH_SIZE = 450;
const EXCLUDED_TABLES = new Set(['sessions']);

function validateReadOnlySqliteRuntime(version = process.versions.node) {
  const [major, minor] = version.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 13) || (major === 23 && minor < 5)) {
    throw new Error('The read-only SQLite importer requires Node.js 22.13 or newer.');
  }
}

function validateEmulatorConfig(env = process.env) {
  const projectId = env.FIREBASE_PROJECT_ID || env.GCLOUD_PROJECT;
  if (!projectId || !projectId.startsWith('demo-')) {
    throw new Error('Set FIREBASE_PROJECT_ID to a demo-* project ID; this importer only targets emulators.');
  }
  if (!env.FIREBASE_AUTH_EMULATOR_HOST || !env.FIRESTORE_EMULATOR_HOST) {
    throw new Error('Set FIREBASE_AUTH_EMULATOR_HOST and FIRESTORE_EMULATOR_HOST before importing.');
  }
  return projectId;
}

function documentId(table, row) {
  if (row.id !== undefined && row.id !== null) return String(row.id);
  if (table === 'lesson_progress') return `${row.user_id}_${row.lesson_id}`;
  if (table === 'sessions') return null;
  throw new Error(`Cannot determine a stable document ID for ${table}.`);
}

function sanitizeRow(table, row, authUid) {
  const safe = { ...row };
  if (table === 'users') {
    delete safe.password_hash;
    delete safe.password_salt;
    safe.auth_uid = authUid;
    safe.password_reset_required = true;
  }
  return safe;
}

async function ensureAuthUser(auth, user) {
  let account;
  try {
    account = await auth.getUserByEmail(user.email);
  } catch (error) {
    if (error.code !== 'auth/user-not-found') throw error;
  }
  if (!account) {
    account = await auth.createUser({
      email: user.email,
      displayName: user.name,
      disabled: !Boolean(user.active)
    });
  } else {
    account = await auth.updateUser(account.uid, {
      displayName: user.name,
      disabled: !Boolean(user.active),
      password: crypto.randomBytes(48).toString('base64url')
    });
  }
  await auth.setCustomUserClaims(account.uid, {
    role: user.role,
    legacyUserId: Number(user.id),
    passwordResetRequired: true
  });
  return account.uid;
}

async function writeRows(firestore, table, rows, userUids = new Map()) {
  let imported = 0;
  for (let offset = 0; offset < rows.length; offset += BATCH_SIZE) {
    const chunk = rows.slice(offset, offset + BATCH_SIZE);
    const batch = firestore.batch();
    for (const row of chunk) {
      const id = documentId(table, row);
      if (!id) continue;
      const uid = table === 'users' ? userUids.get(String(row.id)) : undefined;
      batch.set(firestore.collection(table).doc(id), sanitizeRow(table, row, uid));
      imported += 1;
    }
    if (chunk.length > 0) await batch.commit();
  }
  return imported;
}

async function migrate({ sourceFile, env = process.env } = {}) {
  const projectId = validateEmulatorConfig(env);
  validateReadOnlySqliteRuntime();
  const dbFile = sourceFile || env.DB_PATH || path.join(__dirname, '..', 'data', 'hackademic.db');
  const sqlite = new DatabaseSync(dbFile, { readOnly: true });

  const { getApps, initializeApp } = require('firebase-admin/app');
  const { getAuth } = require('firebase-admin/auth');
  const { getFirestore } = require('firebase-admin/firestore');
  if (!getApps().length) initializeApp({ projectId });
  const firestore = getFirestore();
  const auth = getAuth();
  const tables = sqlite.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  ).all().map(row => row.name).filter(name => !EXCLUDED_TABLES.has(name));
  const userRows = tables.includes('users')
    ? sqlite.prepare('SELECT * FROM users ORDER BY id').all()
    : [];
  const userUids = new Map();
  const counts = {};

  try {
    for (const user of userRows) {
      userUids.set(String(user.id), await ensureAuthUser(auth, user));
    }
    for (const table of tables) {
      const rows = sqlite.prepare(`SELECT * FROM "${table}"`).all();
      counts[table] = await writeRows(firestore, table, rows, userUids);
    }
  } finally {
    sqlite.close();
  }
  return { projectId, counts, skipped: [...EXCLUDED_TABLES] };
}

if (require.main === module) {
  migrate().then(report => {
    console.log(JSON.stringify(report, null, 2));
    console.log('Legacy sessions were not imported. Migrated users must complete Firebase password reset before signing in.');
  }).catch(error => {
    console.error(`Firebase emulator migration failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  documentId,
  sanitizeRow,
  validateEmulatorConfig,
  validateReadOnlySqliteRuntime,
  writeRows,
  migrate
};
