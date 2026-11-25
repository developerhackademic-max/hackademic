'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  documentId,
  ensureAuthUser,
  sanitizeRow,
  validateEmulatorConfig,
  validateReadOnlySqliteRuntime,
  writeRows
} = require('../scripts/migrate-to-firebase');

test('Firebase migration requires both emulators and a demo project', () => {
  assert.throws(() => validateEmulatorConfig({}), /demo-\* project ID/);
  assert.throws(() => validateEmulatorConfig({
    FIREBASE_PROJECT_ID: 'demo-hackademic-local',
    FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099'
  }), /FIRESTORE_EMULATOR_HOST/);
  assert.equal(validateEmulatorConfig({
    FIREBASE_PROJECT_ID: 'demo-hackademic-local',
    FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
    FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080'
  }), 'demo-hackademic-local');
});

test('read-only migration enforces the SQLite API version it needs', () => {
  assert.throws(() => validateReadOnlySqliteRuntime('22.5.0'), /22.13 or newer/);
  assert.throws(() => validateReadOnlySqliteRuntime('23.4.0'), /22.13 or newer/);
  assert.doesNotThrow(() => validateReadOnlySqliteRuntime('22.13.0'));
  assert.doesNotThrow(() => validateReadOnlySqliteRuntime('23.5.0'));
  assert.doesNotThrow(() => validateReadOnlySqliteRuntime('24.0.0'));
});

test('Firestore migration removes password material and marks imported accounts for reset', () => {
  const user = sanitizeRow('users', {
    id: 8, name: 'Learner', password_hash: 'secret-hash', password_salt: 'secret-salt', role: 'student'
  }, 'firebase-uid');
  assert.deepEqual(user, {
    id: 8,
    name: 'Learner',
    role: 'student',
    auth_uid: 'firebase-uid',
    password_reset_required: true
  });
});

test('Firebase Auth migration creates passwordless accounts and requires reset', async () => {
  const user = {
    id: 8,
    name: 'Learner',
    email: 'learner@example.test',
    role: 'student',
    active: 1,
    password_hash: 'a'.repeat(128),
    password_salt: '0123456789abcdef0123456789abcdef'
  };
  let created;
  let claims;
  const auth = {
    getUserByEmail: async () => { throw Object.assign(new Error(), { code: 'auth/user-not-found' }); },
    getUser: async () => { throw Object.assign(new Error(), { code: 'auth/user-not-found' }); },
    createUser: async record => {
      created = record;
      return { uid: record.uid, email: record.email, customClaims: {} };
    },
    setCustomUserClaims: async (uid, value) => { claims = { uid, value }; }
  };
  assert.equal(await ensureAuthUser(auth, user), 'ha-8');
  assert.equal(created.uid, 'ha-8');
  assert.equal(created.email, user.email);
  assert.ok(!('password' in created));
  assert.ok(!('password_hash' in created));
  assert.deepEqual(claims, {
    uid: 'ha-8',
    value: { role: 'student', legacyUserId: 8, passwordResetRequired: true }
  });
});

test('migration refuses to replace an unrelated Firebase account with the same email', async () => {
  let created = false;
  const auth = {
    getUserByEmail: async () => ({ uid: 'existing', email: 'learner@example.test', customClaims: { role: 'admin' } }),
    createUser: async () => { created = true; }
  };
  await assert.rejects(
    ensureAuthUser(auth, {
      id: 8, name: 'Learner', email: 'learner@example.test', role: 'student', active: 1,
      password_hash: 'a'.repeat(128), password_salt: 'b'.repeat(32)
    }),
    /Firebase account collision/
  );
  assert.equal(created, false);
});

test('migration uses stable document IDs for simple and composite-key tables', () => {
  assert.equal(documentId('courses', { id: 12 }), '12');
  assert.equal(documentId('lesson_progress', { user_id: 3, lesson_id: 4 }), '3_4');
  assert.equal(documentId('seo_pages', { page: 'about.html' }), 'about.html');
  assert.equal(documentId('sessions', { token_hash: 'legacy' }), null);
});

test('Firestore row writer stores users without legacy credentials', async () => {
  const writes = [];
  const firestore = {
    collection: name => ({
      doc: id => {
        const ref = { name, id };
        Object.defineProperty(ref, 'get', { value: async () => ({ exists: false }) });
        return ref;
      }
    }),
    batch: () => ({
      set: (ref, value) => writes.push({ ref, value }),
      commit: async () => {}
    })
  };
  const count = await writeRows(firestore, 'users', [{
    id: 8, name: 'Learner', password_hash: 'old-hash', password_salt: 'old-salt'
  }], new Map([['8', 'firebase-uid']]));
  assert.equal(count, 1);
  assert.deepEqual(writes, [{
    ref: { name: 'users', id: '8' },
    value: {
      id: 8, name: 'Learner', auth_uid: 'firebase-uid', password_reset_required: true
    }
  }]);
});
