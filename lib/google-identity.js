'use strict';

const { HttpError } = require('./firebase-runtime');

function normalizedEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function assertLinkedGoogleIdentity(account, profileEmail) {
  const expectedEmail = normalizedEmail(profileEmail);
  if (!account.emailVerified) {
    throw new HttpError(403, 'Verify your Firebase account email before linking Google');
  }
  if (!expectedEmail || normalizedEmail(account.email) !== expectedEmail) {
    throw new HttpError(403, 'Your Firebase email does not match your student profile');
  }
  const providers = (account.providerData || []).filter(provider => provider.providerId === 'google.com');
  if (providers.length !== 1 || normalizedEmail(providers[0].email) !== expectedEmail) {
    throw new HttpError(403, 'Link the Google account that uses your verified Firebase email');
  }
  return providers[0];
}

async function verifyLinkedGoogleIdentity(auth, profile, idToken) {
  let decoded;
  try {
    decoded = await auth.verifyIdToken(idToken, true);
  } catch {
    throw new HttpError(401, 'Google link verification failed');
  }
  if (decoded.uid !== profile.auth_uid) {
    throw new HttpError(403, 'The Google link belongs to a different Firebase account');
  }
  const account = await auth.getUser(decoded.uid);
  const provider = assertLinkedGoogleIdentity(account, profile.email);
  return { account, provider };
}

module.exports = { assertLinkedGoogleIdentity, verifyLinkedGoogleIdentity };
