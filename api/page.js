'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { firebase } = require('../lib/firebase-runtime');
const { applySeo } = require('../lib/seo');

const publicRoot = path.join(__dirname, '..', 'public');
const securityHeaders = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff'
};

function validServiceAccount(projectId) {
  let account;
  try {
    account = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '');
  } catch {
    console.error('Dynamic SEO disabled: FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON.');
    return false;
  }
  if (!account || account.type !== 'service_account'
    || account.project_id !== projectId
    || typeof account.client_email !== 'string'
    || typeof account.private_key !== 'string') {
    console.error('Dynamic SEO disabled: service-account JSON does not match the Firebase project.');
    return false;
  }
  return true;
}

module.exports = async function page(request, response) {
  try {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' });
      response.end();
      return;
    }
    const url = new URL(request.url, 'https://local.invalid');
    let filename = url.searchParams.get('path') || '';
    try { filename = decodeURIComponent(filename); } catch { filename = ''; }
    if (!/^[A-Za-z0-9._-]+\.html$/.test(filename) || filename === '404.html') {
      response.writeHead(404, securityHeaders);
      response.end('<h1>404 - Page Not Found</h1>');
      return;
    }
    let html;
    try {
      html = await fs.readFile(path.join(publicRoot, filename), 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') {
        response.writeHead(404, securityHeaders);
        response.end('<h1>404 - Page Not Found</h1>');
        return;
      }
      throw error;
    }
    const projectId = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT;
    if (projectId && process.env.FIREBASE_SERVICE_ACCOUNT_JSON && validServiceAccount(projectId)) {
      const { firestore } = firebase();
      const seo = await firestore.collection('seo_pages').doc(filename).get();
      if (seo.exists) html = applySeo(html, seo.data());
    }
    response.writeHead(200, securityHeaders);
    response.end(request.method === 'HEAD' ? undefined : html);
  } catch (error) {
    console.error(error);
    response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end('Could not render page');
  }
};
