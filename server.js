'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const api = require('./api/[...path].js');
const pageApi = require('./api/page.js');
const sitemapApi = require('./api/sitemap.js');
const robotsApi = require('./api/robots.js');
const { firebase } = require('./api/firebase-runtime');
const { applySeo } = require('./api/seo');

const publicRoot = path.join(__dirname, 'public');
const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8'
};

function loadLocalEnvironment() {
  const filename = path.join(__dirname, '.env');
  if (!fs.existsSync(filename)) return;
  for (const line of fs.readFileSync(filename, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || Object.prototype.hasOwnProperty.call(process.env, match[1])) continue;
    const value = match[2].replace(/^(['"])(.*)\1$/, '$2');
    process.env[match[1]] = value;
  }
}

loadLocalEnvironment();

function staticFile(request, response) {
  if (!['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(405, { Allow: 'GET, HEAD' });
    response.end();
    return;
  }
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  } catch {
    response.writeHead(400);
    response.end('Bad URL');
    return;
  }
  const relativePath = pathname === '/' ? 'index.html' : pathname.slice(1);
  const filename = path.resolve(publicRoot, relativePath);
  if (!filename.startsWith(publicRoot + path.sep)) {
    response.writeHead(403);
    response.end('Forbidden');
    return;
  }
  fs.readFile(filename, async (error, content) => {
    if (error) {
      fs.readFile(path.join(publicRoot, '404.html'), (notFoundError, notFound) => {
        response.writeHead(404, {
          'Content-Type': 'text/html; charset=utf-8',
          'X-Content-Type-Options': 'nosniff'
        });
        response.end(notFoundError ? '<h1>404 - Page Not Found</h1>' : notFound);
      });
      return;
    }
    const extension = path.extname(filename).toLowerCase();
    if (extension === '.html' && process.env.FIREBASE_PROJECT_ID) {
      try {
        const { firestore } = firebase();
        const seo = await firestore.collection('seo_pages').doc(path.basename(filename)).get();
        if (seo.exists) content = Buffer.from(applySeo(content.toString('utf8'), seo.data()));
      } catch (runtimeError) {
        console.error(runtimeError);
        response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end('Could not render page metadata');
        return;
      }
    }
    response.writeHead(200, {
      'Content-Type': contentTypes[extension] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com; img-src 'self' data: https://*.googleusercontent.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://fonts.gstatic.com https://apis.google.com; font-src 'self' https://fonts.gstatic.com; script-src 'self' 'unsafe-inline' https://www.gstatic.com https://apis.google.com; connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://www.googleapis.com https://accounts.google.com https://oauth2.googleapis.com http://127.0.0.1:9099 http://localhost:9099; frame-src https://accounts.google.com https://drive.google.com https://docs.google.com https://*.firebaseapp.com https://www.google.com https://maps.google.com; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
    });
    if (request.method === 'HEAD') response.end();
    else response.end(content);
  });
}

const server = http.createServer((request, response) => {
  let pathname;
  try {
    pathname = new URL(request.url, 'http://localhost').pathname;
  } catch {
    response.writeHead(400);
    response.end('Bad URL');
    return;
  }
  if (pathname.startsWith('/api/')) {
    if (pathname === '/api/page') pageApi(request, response);
    else api(request, response);
    return;
  }
  if (pathname === '/sitemap.xml') {
    sitemapApi(request, response);
    return;
  }
  if (pathname === '/robots.txt') {
    robotsApi(request, response);
    return;
  }
  staticFile(request, response);
});

const port = Number(process.env.PORT) || 3000;
if (require.main === module) {
  server.listen(port, () => {
    console.log(`Hackademic Firebase app listening on http://127.0.0.1:${port}`);
  });
}

module.exports = server;
