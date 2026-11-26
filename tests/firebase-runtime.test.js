'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { findUserSnapshot } = require('../lib/firebase-runtime');

test('profile lookup falls back to auth UID when the legacy ID claim points elsewhere', async () => {
  const claimedProfile = {
    exists: true,
    data: () => ({ id: 12, auth_uid: 'another-auth-uid' })
  };
  const matchingProfile = {
    exists: true,
    data: () => ({ id: 746684, auth_uid: 'director-auth-uid' })
  };
  let queriedUid;

  const firestore = {
    collection(name) {
      assert.equal(name, 'users');
      return {
        doc(id) {
          assert.equal(id, '12');
          return { get: async () => claimedProfile };
        },
        where(field, operator, value) {
          assert.equal(field, 'auth_uid');
          assert.equal(operator, '==');
          queriedUid = value;
          return {
            limit: count => {
              assert.equal(count, 1);
              return { get: async () => ({ docs: [matchingProfile] }) };
            }
          };
        }
      };
    }
  };

  const snapshot = await findUserSnapshot(firestore, 'director-auth-uid', 12);

  assert.equal(queriedUid, 'director-auth-uid');
  assert.equal(snapshot, matchingProfile);
});
