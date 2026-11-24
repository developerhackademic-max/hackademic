'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  documentId,
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

test('migration removes legacy password material and marks imported accounts for reset', () => {
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

test('migration uses stable document IDs for simple and composite-key tables', () => {
  assert.equal(documentId('courses', { id: 12 }), '12');
  assert.equal(documentId('lesson_progress', { user_id: 3, lesson_id: 4 }), '3_4');
  assert.equal(documentId('sessions', { token_hash: 'legacy' }), null);
});

test('Firestore row writer stores users without legacy credentials', async () => {
  const writes = [];
  const firestore = {
    collection: name => ({
      doc: id => ({ name, id })
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
