'use strict';

const path = require('node:path');
const { firebase } = require('./firebase-runtime');
const { sitemapXml } = require('./seo');

module.exports = async function sitemap(request, response) {
  try {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' });
      response.end();
      return;
    }
    const { firestore } = firebase();
    const xml = await sitemapXml(firestore, path.join(__dirname, '..', 'public'));
    response.writeHead(200, {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    });
    response.end(request.method === 'HEAD' ? undefined : xml);
  } catch (error) {
    console.error(error);
    response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end('Could not generate sitemap');
  }
};
