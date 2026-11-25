const { rewrite } = require('@vercel/functions');

module.exports = function routeHtmlThroughSeo(request) {
  const source = new URL(request.url);
  const filename = source.pathname === '/' ? 'index.html' : source.pathname.slice(1);
  const destination = new URL('/api/page', request.url);
  destination.searchParams.set('path', filename);
  return rewrite(destination);
};
