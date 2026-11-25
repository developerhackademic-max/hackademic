'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const api = require('../api/[...path].js');
const page = require('../api/page.js');

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

test('health and static pages work before Firebase configuration is present', async () => {
  const previousProjectId = process.env.FIREBASE_PROJECT_ID;
  const previousGcloudProject = process.env.GCLOUD_PROJECT;
  delete process.env.FIREBASE_PROJECT_ID;
  delete process.env.GCLOUD_PROJECT;

  try {
    const health = responseRecorder();
    await api({ method: 'GET', url: '/api/health', headers: {} }, health);
    assert.equal(health.statusCode, 200);
    assert.deepEqual(JSON.parse(health.body), { ok: true });

    const html = responseRecorder();
    await page({ method: 'GET', url: '/api/page?path=index.html' }, html);
    assert.equal(html.statusCode, 200);
    assert.match(html.body, /<html/i);
  } finally {
    if (previousProjectId === undefined) delete process.env.FIREBASE_PROJECT_ID;
    else process.env.FIREBASE_PROJECT_ID = previousProjectId;
    if (previousGcloudProject === undefined) delete process.env.GCLOUD_PROJECT;
    else process.env.GCLOUD_PROJECT = previousGcloudProject;
  }
});
