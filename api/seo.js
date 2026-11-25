'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { list, getById } = require('./firestore-store');

const SITE_ORIGIN = 'https://www.hackademic.in';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function replaceHeadElements(html, pattern, markup) {
  const stripped = html.replace(pattern, '');
  return markup ? stripped.replace(/<\/head>/i, `${markup}\n</head>`) : stripped;
}

function applySeo(html, seo) {
  let output = html.replace(/<title\b[^>]*>[\s\S]*?<\/title>/i, `<title>${escapeHtml(seo.title)}</title>`);
  if (!/<title\b/i.test(output)) output = output.replace(/<\/head>/i, `<title>${escapeHtml(seo.title)}</title>\n</head>`);
  const tags = [
    [/<meta\b(?=[^>]*\bname=["']description["'])[^>]*>/gi, seo.description ? `<meta name="description" content="${escapeHtml(seo.description)}">` : ''],
    [/<meta\b(?=[^>]*\bname=["']robots["'])[^>]*>/gi, `<meta name="robots" content="${escapeHtml(seo.robots)}">`],
    [/<link\b(?=[^>]*\brel=["']canonical["'])[^>]*>/gi, seo.canonical ? `<link rel="canonical" href="${escapeHtml(seo.canonical)}">` : ''],
    [/<meta\b(?=[^>]*\bproperty=["']og:title["'])[^>]*>/gi, seo.og_title ? `<meta property="og:title" content="${escapeHtml(seo.og_title)}">` : ''],
    [/<meta\b(?=[^>]*\bproperty=["']og:description["'])[^>]*>/gi, seo.og_description ? `<meta property="og:description" content="${escapeHtml(seo.og_description)}">` : ''],
    [/<meta\b(?=[^>]*\bproperty=["']og:image["'])[^>]*>/gi, seo.og_image ? `<meta property="og:image" content="${escapeHtml(seo.og_image)}">` : ''],
    [/<meta\b(?=[^>]*\bproperty=["']og:url["'])[^>]*>/gi, `<meta property="og:url" content="${escapeHtml(seo.canonical)}">`],
    [/<meta\b(?=[^>]*\bname=["']twitter:title["'])[^>]*>/gi, seo.og_title ? `<meta name="twitter:title" content="${escapeHtml(seo.og_title)}">` : ''],
    [/<meta\b(?=[^>]*\bname=["']twitter:description["'])[^>]*>/gi, seo.og_description ? `<meta name="twitter:description" content="${escapeHtml(seo.og_description)}">` : ''],
    [/<meta\b(?=[^>]*\bname=["']twitter:image["'])[^>]*>/gi, seo.og_image ? `<meta name="twitter:image" content="${escapeHtml(seo.og_image)}">` : '']
  ];
  for (const [pattern, markup] of tags) output = replaceHeadElements(output, pattern, markup);
  return output;
}

async function getSeoPages(firestore, publicRoot = path.join(__dirname, '..', 'public')) {
  const savedPages = new Map((await list(firestore, 'seo_pages')).map(item => [item.page, item]));
  return fs.readdirSync(publicRoot)
    .filter(page => page.endsWith('.html') && page !== '404.html')
    .map(page => {
      const source = fs.readFileSync(path.join(publicRoot, page), 'utf8');
      const extract = pattern => (source.match(pattern) || [])[1] || '';
      const title = extract(/<title\b[^>]*>([\s\S]*?)<\/title>/i) || page;
      const robots = extract(/<meta\b(?=[^>]*\bname=["']robots["'])[^>]*\bcontent=["']([^"']*)["'][^>]*>/i) || 'index,follow';
      const defaults = {
        page,
        url: page === 'index.html' ? '/' : `/${page}`,
        title,
        description: extract(/<meta\b(?=[^>]*\bname=["']description["'])[^>]*\bcontent=["']([^"']*)["'][^>]*>/i),
        canonical: extract(/<link\b(?=[^>]*\brel=["']canonical["'])[^>]*\bhref=["']([^"']*)["'][^>]*>/i)
          || `${SITE_ORIGIN}${page === 'index.html' ? '/' : `/${page}`}`,
        robots,
        og_title: extract(/<meta\b(?=[^>]*\bproperty=["']og:title["'])[^>]*\bcontent=["']([^"']*)["'][^>]*>/i) || title,
        og_description: extract(/<meta\b(?=[^>]*\bproperty=["']og:description["'])[^>]*\bcontent=["']([^"']*)["'][^>]*>/i),
        og_image: extract(/<meta\b(?=[^>]*\bproperty=["']og:image["'])[^>]*\bcontent=["']([^"']*)["'][^>]*>/i),
        include_sitemap: Number(!/noindex/i.test(robots)),
        changefreq: 'monthly',
        priority: page === 'index.html' ? 1 : 0.6
      };
      const saved = savedPages.get(page) || {};
      return {
        ...defaults,
        ...saved,
        url: defaults.url,
        include_sitemap: Number(saved.include_sitemap ?? defaults.include_sitemap),
        priority: Number(saved.priority ?? defaults.priority)
      };
    })
    .sort((a, b) => a.url.localeCompare(b.url));
}

async function robotsTxt(firestore) {
  const saved = await getById(firestore, 'seo_robots', 1);
  return saved?.content || 'User-agent: *\nAllow: /\n';
}

async function sitemapXml(firestore, publicRoot) {
  const pages = (await getSeoPages(firestore, publicRoot))
    .filter(page => page.include_sitemap && !/noindex/i.test(page.robots));
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${pages.map(page =>
    `  <url><loc>${escapeHtml(page.canonical)}</loc><changefreq>${escapeHtml(page.changefreq)}</changefreq><priority>${Number(page.priority).toFixed(1)}</priority></url>`
  ).join('\n')}\n</urlset>\n`;
}

module.exports = { applySeo, getSeoPages, robotsTxt, sitemapXml };
