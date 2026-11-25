import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-app.js';
import {
  GoogleAuthProvider,
  connectAuthEmulator,
  getAuth,
  linkWithPopup,
  reload,
  sendEmailVerification,
  signInWithEmailAndPassword,
  signOut,
  unlink
} from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js';

let authPromise;

async function clientAuth() {
  if (!authPromise) {
    authPromise = (async () => {
      const response = await fetch('/api/auth/config', { credentials: 'same-origin' });
      const config = await response.json();
      if (!response.ok) throw new Error(config.error || 'Firebase authentication is not configured');
      const auth = getAuth(initializeApp({
        apiKey: config.apiKey,
        authDomain: config.authDomain,
        projectId: config.projectId,
        appId: config.appId
      }));
      if (config.authEmulatorUrl) {
        connectAuthEmulator(auth, config.authEmulatorUrl, { disableWarnings: true });
      }
      return auth;
    })();
  }
  return authPromise;
}

async function createPortalSession(user) {
  const response = await fetch('/api/auth/session', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken: await user.getIdToken() })
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Could not start your portal session');
  return result;
}

async function linkProviderToSession(user, csrf) {
  const response = await fetch('/api/auth/link-google', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    body: JSON.stringify({ idToken: await user.getIdToken(true) })
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Google account verification failed');
  return result;
}

export const portalAuth = {
  initialize: clientAuth,

  async signIn(email, password) {
    const auth = await clientAuth();
    const credential = await signInWithEmailAndPassword(auth, email, password);
    try {
      return await createPortalSession(credential.user);
    } catch (error) {
      await signOut(auth);
      throw error;
    }
  },

  async sendVerification() {
    const auth = await clientAuth();
    const user = auth.currentUser;
    if (!user) throw new Error('Sign in again before requesting email verification');
    await reload(user);
    if (!user.emailVerified) await sendEmailVerification(user);
  },

  async linkGoogle(csrf) {
    const auth = await clientAuth();
    const user = auth.currentUser;
    if (!user) throw new Error('Sign in again before linking Google');
    await reload(user);
    if (!user.emailVerified) throw new Error('Verify your Firebase email before linking Google');

    const existing = user.providerData.find(provider => provider.providerId === 'google.com');
    if (existing) {
      if (existing.email?.trim().toLowerCase() !== user.email?.trim().toLowerCase()) {
        throw new Error('A different Google account is already linked. Contact an administrator for help.');
      }
      return linkProviderToSession(user, csrf);
    }

    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    const linked = await linkWithPopup(user, provider);
    const linkedGoogle = linked.user.providerData.find(item => item.providerId === 'google.com');
    if (!linkedGoogle || linkedGoogle.email?.trim().toLowerCase() !== user.email?.trim().toLowerCase()) {
      await unlink(linked.user, 'google.com');
      throw new Error('The Google account must exactly match your Firebase email');
    }
    return linkProviderToSession(linked.user, csrf);
  },

  async signOut() {
    const auth = await clientAuth();
    await signOut(auth);
  }
};
