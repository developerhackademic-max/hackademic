'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { HttpError } = require('../lib/firebase-runtime');
const { assertLinkedGoogleIdentity } = require('../lib/google-identity');

test('Google linking requires a verified matching Firebase email and one Google provider', () => {
  const account = {
    email: 'student@example.test',
    emailVerified: true,
    providerData: [
      { providerId: 'password', email: 'student@example.test' },
      { providerId: 'google.com', email: 'student@example.test' }
    ]
  };
  assert.equal(assertLinkedGoogleIdentity(account, 'STUDENT@example.test').email, 'student@example.test');
});

test('Google linking rejects unverified, mismatched, or ambiguous provider accounts', () => {
  const account = {
    email: 'student@example.test',
    emailVerified: false,
    providerData: [{ providerId: 'google.com', email: 'student@example.test' }]
  };
  assert.throws(() => assertLinkedGoogleIdentity(account, account.email), error =>
    error instanceof HttpError && error.status === 403
  );

  assert.throws(() => assertLinkedGoogleIdentity({
    ...account,
    emailVerified: true,
    providerData: [{ providerId: 'google.com', email: 'different@example.test' }]
  }, account.email), error => error instanceof HttpError && error.status === 403);

  assert.throws(() => assertLinkedGoogleIdentity({
    ...account,
    emailVerified: true,
    providerData: [
      { providerId: 'google.com', email: account.email },
      { providerId: 'google.com', email: account.email }
    ]
  }, account.email), error => error instanceof HttpError && error.status === 403);
});
