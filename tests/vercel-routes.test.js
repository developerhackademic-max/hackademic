'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const api = require('../api/[...path].js');
const page = require('../api/page.js');

test('legacy About URL redirects to the canonical page', () => {
  const config = JSON.parse(fs.readFileSync(require.resolve('../vercel.json'), 'utf8'));
  assert.ok(config.redirects.some(redirect =>
    redirect.source === '/about' &&
    redirect.destination === '/about.html' &&
    redirect.permanent === true
  ));
});

test('legacy course application URLs redirect to the enrollment form with the course', () => {
  const config = JSON.parse(fs.readFileSync(require.resolve('../vercel.json'), 'utf8'));
  assert.ok(config.redirects.some(redirect =>
    redirect.source === '/apply/:course' &&
    redirect.destination === '/enroll.html?course=:course' &&
    redirect.permanent === true
  ));
});

function responseRecorder() {
  return {
    statusCode: null,
    headers: null,
    body: '',
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    end(body = '') {
      this.body = body;
    }
  };
}

test('health and static pages work without Firebase Admin credentials', async () => {
  const keys = [
    'FIREBASE_PROJECT_ID',
    'GCLOUD_PROJECT',
    'FIREBASE_WEB_API_KEY',
    'FIREBASE_AUTH_DOMAIN',
    'FIREBASE_WEB_APP_ID',
    'FIREBASE_AUTH_EMULATOR_HOST',
    'FIREBASE_SERVICE_ACCOUNT_JSON'
  ];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];

  try {
    const health = responseRecorder();
    await api({ method: 'GET', url: '/api/health', headers: {} }, health);
    assert.equal(health.statusCode, 200);
    assert.deepEqual(JSON.parse(health.body), { ok: true });

    const authConfig = responseRecorder();
    await api({ method: 'GET', url: '/api/auth/config', headers: {} }, authConfig);
    assert.equal(authConfig.statusCode, 503);
    assert.deepEqual(JSON.parse(authConfig.body), {
      error: 'Firebase client authentication is not configured'
    });

    process.env.FIREBASE_PROJECT_ID = 'hackademic-website';
    const html = responseRecorder();
    await page({ method: 'GET', url: '/api/page?path=index.html' }, html);
    assert.equal(html.statusCode, 200);
    assert.match(html.body, /<html/i);
    assert.match(html.body, /<meta property="og:site_name" content="HACKADEMIC PVT LTD">/);
    assert.match(html.body, /"@type":"WebSite","name":"HACKADEMIC PVT LTD"/);

    const portal = responseRecorder();
    await page({ method: 'GET', url: '/api/page?path=portal.html' }, portal);
    assert.equal(portal.statusCode, 200);
    assert.match(portal.body, /id="loginForm"/);
    assert.doesNotMatch(portal.body, /showPasswordReset|passwordResetForm|Forgot your password|Send reset instructions|Use password reset/i);

    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = '{invalid';
    const htmlWithInvalidCredentials = responseRecorder();
    await page({ method: 'GET', url: '/api/page?path=index.html' }, htmlWithInvalidCredentials);
    assert.equal(htmlWithInvalidCredentials.statusCode, 200);
    assert.match(htmlWithInvalidCredentials.body, /<html/i);
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});
