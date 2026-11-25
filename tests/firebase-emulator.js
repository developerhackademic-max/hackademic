'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { getApps, initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
const { migrate } = require('../scripts/migrate-to-firebase');

const projectId = process.env.FIREBASE_PROJECT_ID;
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const sourceFile = process.env.MIGRATION_SOURCE_FILE
  || path.join(__dirname, '..', 'data', 'hackademic-before-firebase-20261124.db');
const apiKey = 'fake-api-key';

async function clearDemoEmulators(auth, firestore) {
  let pageToken;
  do {
    const page = await auth.listUsers(1000, pageToken);
    if (page.users.length) await auth.deleteUsers(page.users.map(user => user.uid));
    pageToken = page.pageToken;
  } while (pageToken);

  for (const collection of await firestore.listCollections()) {
    const snapshot = await collection.get();
    for (let offset = 0; offset < snapshot.docs.length; offset += 450) {
      const batch = firestore.batch();
      snapshot.docs.slice(offset, offset + 450).forEach(document => batch.delete(document.ref));
      await batch.commit();
    }
  }
}

test('SQLite migration, Firestore records, and Firebase password reset work in emulators', {
  skip: !projectId || !projectId.startsWith('demo-') || !authHost || !process.env.FIRESTORE_EMULATOR_HOST
    ? 'Set the two Firebase emulator hosts and a demo-* project ID.'
    : false
}, async () => {
  const sqlite = new DatabaseSync(sourceFile, { readOnly: true });
  try {
    if (!getApps().some(app => app.options.projectId === projectId)) initializeApp({ projectId });
    const auth = getAuth();
    const firestore = getFirestore();
    await clearDemoEmulators(auth, firestore);
    const report = await migrate({ sourceFile });
    assert.equal(report.projectId, projectId);
    assert.ok(report.skipped.includes('sessions'));

    const tables = sqlite.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    ).all().map(row => row.name).filter(name => name !== 'sessions');

    for (const table of tables) {
      const expected = Number(sqlite.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get().n);
      assert.equal((await firestore.collection(table).get()).size, expected, `${table} count`);
    }

    const users = sqlite.prepare('SELECT id,email,role FROM users ORDER BY id').all();
    for (const user of users) {
      const profile = (await firestore.collection('users').doc(String(user.id)).get()).data();
      assert.equal(profile.auth_uid, `ha-${user.id}`);
      assert.equal(profile.password_reset_required, true);
      assert.equal('password_hash' in profile, false);
      assert.equal('password_salt' in profile, false);
    }

    const host = `http://${authHost}`;
    async function post(pathname, body) {
      const response = await fetch(
        `${host}/identitytoolkit.googleapis.com/v1/${pathname}?key=${apiKey}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      );
      const result = await response.json();
      assert.equal(response.ok, true, `${pathname}: ${result.error?.message || response.status}`);
      return result;
    }

    for (const user of users) {
      await post('accounts:sendOobCode', { requestType: 'PASSWORD_RESET', email: user.email });
    }
    const codesResponse = await fetch(
      `${host}/emulator/v1/projects/${projectId}/oobCodes`
    );
    assert.equal(codesResponse.ok, true);
    const { oobCodes = [] } = await codesResponse.json();

    for (const user of users) {
      const reset = oobCodes.filter(code =>
        code.email?.toLowerCase() === user.email.toLowerCase()
        && code.requestType === 'PASSWORD_RESET'
      ).pop();
      assert.ok(reset?.oobCode, 'reset code was generated');

      const password = `${crypto.randomBytes(24).toString('base64url')}Aa1!`;
      await post('accounts:resetPassword', { oobCode: reset.oobCode, newPassword: password });
      const signedIn = await post('accounts:signInWithPassword', {
        email: user.email,
        password,
        returnSecureToken: true
      });
      const claims = await auth.verifyIdToken(signedIn.idToken);
      assert.equal(claims.legacyUserId, Number(user.id));
      assert.equal(claims.role, user.role);
    }
  } finally {
    sqlite.close();
  }
});
