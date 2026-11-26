'use strict';

const crypto = require('node:crypto');
const { cert, getApps, initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');

const SESSION_SECONDS = 24 * 60 * 60;

function firebase() {
  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT;
  if (!projectId) throw new Error('FIREBASE_PROJECT_ID is required.');
  const emulatorConfigured = Boolean(
    process.env.FIREBASE_AUTH_EMULATOR_HOST
    || process.env.FIRESTORE_EMULATOR_HOST
  );
  if (emulatorConfigured && !projectId.startsWith('demo-')) {
    throw new Error('Firebase emulators may only be used with a demo-* project ID.');
  }

  let app = getApps().find(item => item.options.projectId === projectId);
  if (!app) {
    const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    const options = { projectId };
    if (serviceAccountJson) {
      let serviceAccount;
      try {
        serviceAccount = JSON.parse(serviceAccountJson);
      } catch {
        throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON must contain valid JSON.');
      }
      options.credential = cert(serviceAccount);
    } else if (!process.env.FIREBASE_AUTH_EMULATOR_HOST) {
      throw new Error('Set FIREBASE_SERVICE_ACCOUNT_JSON for non-emulator Firebase access.');
    }
    app = initializeApp(options, `hackademic-${projectId}`);
  }
  return {
    auth: getAuth(app),
    firestore: getFirestore(app)
  };
}

class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function clean(value, max = 200) {
  return String(value ?? '').trim().slice(0, max);
}

function required(value, label, max = 200) {
  const result = clean(value, max);
  if (!result) throw new HttpError(400, `${label} is required`);
  return result;
}

function readCookie(request, name) {
  const prefix = `${name}=`;
  for (const part of String(request.headers.cookie || '').split(';')) {
    const item = part.trim();
    if (item.startsWith(prefix)) {
      try {
        return decodeURIComponent(item.slice(prefix.length));
      } catch {
        return '';
      }
    }
  }
  return '';
}

function setCookie(response, name, value, options = {}) {
  const attributes = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'SameSite=Strict'];
  if (options.httpOnly) attributes.push('HttpOnly');
  if (options.maxAge !== undefined) attributes.push(`Max-Age=${options.maxAge}`);
  if (process.env.NODE_ENV === 'production') attributes.push('Secure');
  const existing = response.getHeader('Set-Cookie');
  const cookies = existing ? (Array.isArray(existing) ? existing : [existing]) : [];
  response.setHeader('Set-Cookie', [...cookies, attributes.join('; ')]);
}

function clearSessionCookies(response) {
  setCookie(response, 'ha_session', '', { httpOnly: true, maxAge: 0 });
  setCookie(response, 'ha_csrf', '', { maxAge: 0 });
}

function sendJson(response, status, value, headers = {}) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers
  });
  response.end(JSON.stringify(value));
}

async function readJson(request) {
  if (request.body && typeof request.body === 'object') return request.body;
  let raw = '';
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 100000) throw new HttpError(413, 'Request too large');
  }
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    throw new HttpError(400, 'Invalid JSON');
  }
}

async function identityToolkit(action, payload) {
  const key = process.env.FIREBASE_WEB_API_KEY;
  if (!key) throw new Error('FIREBASE_WEB_API_KEY is required for Firebase Authentication.');
  const emulator = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  const base = emulator
    ? `http://${emulator}/identitytoolkit.googleapis.com/v1`
    : 'https://identitytoolkit.googleapis.com/v1';
  const response = await fetch(`${base}/${action}?key=${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const result = await response.json();
  if (!response.ok) {
    const code = result.error?.message || 'AUTH_REQUEST_FAILED';
    if (action === 'accounts:signInWithPassword') throw new HttpError(401, 'Invalid credentials', code);
    if (action === 'accounts:resetPassword') throw new HttpError(400, 'Invalid or expired reset code', code);
    throw new HttpError(400, code, code);
  }
  return result;
}

async function findUserSnapshot(firestore, uid, legacyId) {
  let snapshot;
  if (Number.isSafeInteger(legacyId) && legacyId > 0) {
    snapshot = await firestore.collection('users').doc(String(legacyId)).get();
  }
  if (!snapshot?.exists || snapshot.data().auth_uid !== uid) {
    const matches = await firestore.collection('users').where('auth_uid', '==', uid).limit(1).get();
    snapshot = matches.docs[0];
  }
  return snapshot;
}

async function findProfile(firestore, decoded) {
  const legacyId = Number(decoded.legacyUserId);
  const snapshot = await findUserSnapshot(firestore, decoded.uid, legacyId);
  if (!snapshot?.exists) throw new HttpError(401, 'Account profile not found');
  const profile = snapshot.data();
  if (profile.auth_uid !== decoded.uid || !profile.active) throw new HttpError(403, 'Account is disabled');
  return { ...profile, id: Number(profile.id), docId: snapshot.id };
}

async function requireUser(request, auth, firestore) {
  const session = readCookie(request, 'ha_session');
  if (!session) throw new HttpError(401, 'Please sign in');
  let decoded;
  try {
    decoded = await auth.verifySessionCookie(session, true);
  } catch {
    throw new HttpError(401, 'Please sign in');
  }
  const csrf = readCookie(request, 'ha_csrf');
  if (!csrf) throw new HttpError(403, 'Invalid CSRF token');
  const user = await findProfile(firestore, decoded);
  user.csrf = csrf;
  return user;
}

function guard(user, roles) {
  if (!user) throw new HttpError(401, 'Please sign in');
  if (roles && !roles.includes(user.role)) throw new HttpError(403, 'Access denied');
}

function requireCsrf(request, user) {
  if (request.headers['x-csrf-token'] !== user.csrf) throw new HttpError(403, 'Invalid CSRF token');
}

function randomCsrf() {
  return crypto.randomBytes(24).toString('hex');
}

function now() {
  return new Date().toISOString();
}

async function createSession(response, auth, idToken) {
  const session = await auth.createSessionCookie(idToken, { expiresIn: SESSION_SECONDS * 1000 });
  const csrf = randomCsrf();
  setCookie(response, 'ha_session', session, { httpOnly: true, maxAge: SESSION_SECONDS });
  setCookie(response, 'ha_csrf', csrf, { maxAge: SESSION_SECONDS });
  return csrf;
}

async function signIn(request, response, auth, firestore, body) {
  const email = required(body.email, 'Email', 254).toLowerCase();
  const password = required(body.password, 'Password', 300);
  const result = await identityToolkit('accounts:signInWithPassword', {
    email,
    password,
    returnSecureToken: true
  });
  const decoded = await auth.verifyIdToken(result.idToken);
  const profile = await findProfile(firestore, decoded);
  if (profile.password_reset_required) {
    await firestore.collection('users').doc(profile.docId).update({ password_reset_required: false });
    const account = await auth.getUser(decoded.uid);
    await auth.setCustomUserClaims(decoded.uid, {
      ...account.customClaims,
      role: profile.role,
      legacyUserId: profile.id,
      passwordResetRequired: false
    });
  }
  const csrf = await createSession(response, auth, result.idToken);
  return { user: { id: profile.id, name: profile.name, email: profile.email, role: profile.role }, csrf };
}

async function createSessionFromIdToken(response, auth, firestore, body) {
  const idToken = required(body.idToken, 'Firebase ID token', 8192);
  let decoded;
  try {
    decoded = await auth.verifyIdToken(idToken, true);
  } catch {
    throw new HttpError(401, 'Please sign in again');
  }
  const profile = await findProfile(firestore, decoded);
  if (profile.password_reset_required) {
    await firestore.collection('users').doc(profile.docId).update({ password_reset_required: false });
    const account = await auth.getUser(decoded.uid);
    await auth.setCustomUserClaims(decoded.uid, {
      ...account.customClaims,
      role: profile.role,
      legacyUserId: profile.id,
      passwordResetRequired: false
    });
  }
  const csrf = await createSession(response, auth, idToken);
  return { user: { id: profile.id, name: profile.name, email: profile.email, role: profile.role }, csrf };
}

function publicOrigin() {
  if (process.env.PUBLIC_APP_ORIGIN) {
    const url = new URL(process.env.PUBLIC_APP_ORIGIN);
    if (url.username || url.password || !['http:', 'https:'].includes(url.protocol)
      || (process.env.NODE_ENV === 'production' && url.protocol !== 'https:')) {
      throw new Error('PUBLIC_APP_ORIGIN must be an HTTPS origin in production.');
    }
    return url.origin;
  }
  if (process.env.VERCEL_URL) return new URL(`https://${process.env.VERCEL_URL}`).origin;
  return 'https://www.hackademic.in';
}

async function requestPasswordReset(request, body) {
  const email = required(body.email, 'Email', 254).toLowerCase();
  const continueUrl = new URL('/reset-password.html', publicOrigin()).toString();
  try {
    await identityToolkit('accounts:sendOobCode', {
      requestType: 'PASSWORD_RESET',
      email,
      continueUrl
    });
  } catch (error) {
    if (!['EMAIL_NOT_FOUND', 'USER_NOT_FOUND'].includes(error.code)) throw error;
  }
  return { ok: true, message: 'If an account exists for that email, password reset instructions have been sent.' };
}

async function confirmPasswordReset(body, auth, firestore) {
  const oobCode = required(body.oobCode, 'Reset code', 4096);
  const newPassword = required(body.newPassword, 'New password', 256);
  if (newPassword.length < 12) throw new HttpError(400, 'Password must have at least 12 characters');
  const result = await identityToolkit('accounts:resetPassword', { oobCode, newPassword });
  if (!result.localId && !result.email) throw new HttpError(400, 'Invalid or expired reset code');
  const account = result.localId ? await auth.getUser(result.localId) : await auth.getUserByEmail(result.email);
  const legacyId = Number(account.customClaims?.legacyUserId);
  const userSnapshot = await findUserSnapshot(firestore, account.uid, legacyId);
  if (!userSnapshot?.exists || userSnapshot.data().auth_uid !== account.uid) {
    throw new HttpError(400, 'Account profile not found');
  }
  return { ok: true, message: 'Password updated. Sign in with your new password to continue.' };
}

module.exports = {
  HttpError,
  SESSION_SECONDS,
  clean,
  confirmPasswordReset,
  createSession,
  firebase,
  guard,
  identityToolkit,
  now,
  publicOrigin,
  readCookie,
  readJson,
  requestPasswordReset,
  requireCsrf,
  requireUser,
  sendJson,
  setCookie,
  clearSessionCookies,
  createSessionFromIdToken,
  findUserSnapshot,
  signIn
};
