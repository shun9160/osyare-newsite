// Builds dist/: one HTML file per URL (each with its own title, description, canonical and
// structured data), plus sitemap.xml, robots.txt and redirects from the old WordPress site.
// Netlify runs this on every deploy (see netlify.toml). Local check: node build.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SITE = 'https://www.osyareclub.com';
// Search engines may index the site only once it is served from the real domain.
// Until then (osyare-club.netlify.app, deploy previews, local builds) every page is noindex.
const LIVE = process.env.SITE_LIVE === '1' ||
  (process.env.CONTEXT === 'production' && /osyareclub\.com/.test(process.env.URL || ''));

const OUT = path.join(__dirname, 'dist');
const src = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

// Store, Q&A and page data live in index.html; read them from there so there is one source of truth.
const dataJs = src.slice(src.indexOf('const LINE_URL'), src.indexOf('/* ---------------- end of data'));
const { STORES, QA, ROUTES, PAGE_META, storeMeta, LINE_URL } =
  vm.runInNewContext(dataJs + ';({STORES,QA,ROUTES,PAGE_META,storeMeta,LINE_URL})');

/* ---------- structured data (schema.org) ---------- */
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const hhmm = h => String(Math.floor(h)).padStart(2, '0') + ':' + (h % 1 ? '30' : '00');
function openingHours(s) {
  const by = {};
  DAYS.forEach((day, d) => {
    if (s.closed.includes(d)) return;
    const r = d === 0 ? s.sun : d === 6 ? s.sat : s.wk, k = hhmm(r[0]) + '-' + hhmm(r[1]);
    (by[k] = by[k] || []).push(day);
  });
  return Object.keys(by).map(k => ({ '@type': 'OpeningHoursSpecification', dayOfWeek: by[k], opens: k.split('-')[0], closes: k.split('-')[1] }));
}
const ORG = {
  '@type': 'Organization', '@id': SITE + '/#org', name: 'おしゃれ倶楽部', legalName: '有限会社シティー・ライフ',
  url: SITE + '/', logo: SITE + '/images/logo.png', telephone: '0467-70-8988', faxNumber: '0467-70-8990',
  email: 'cl@mj-group.co.jp', foundingDate: '1990-03',
  address: { '@type': 'PostalAddress', postalCode: '252-1123', addressCountry: 'JP', addressRegion: '神奈川県', addressLocality: '綾瀬市', streetAddress: '早川2687番地' },
  areaServed: ['座間市', '綾瀬市', '海老名市', '厚木市', '大和市', '藤沢市'].map(c => ({ '@type': 'City', name: c })),
  sameAs: [LINE_URL]
};
const WEBSITE = { '@type': 'WebSite', '@id': SITE + '/#website', url: SITE + '/', name: 'おしゃれ倶楽部', inLanguage: 'ja', publisher: { '@id': SITE + '/#org' } };
const storeLd = s => ({
  '@type': 'DryCleaningOrLaundry', '@id': SITE + '/tenpo/' + s.slug + '/#store', name: 'おしゃれ倶楽部 ' + s.name,
  url: SITE + '/tenpo/' + s.slug + '/', image: SITE + '/images/logo.png', telephone: s.tel, priceRange: '¥220〜',
  address: {
    '@type': 'PostalAddress', postalCode: s.zip, addressCountry: 'JP', addressRegion: '神奈川県',
    addressLocality: s.city, streetAddress: s.addr.replace(/^神奈川県/, '').replace(s.city, '')
  },
  openingHoursSpecification: openingHours(s), parentOrganization: { '@id': SITE + '/#org' }, areaServed: s.city
});
const crumbs = list => ({
  '@type': 'BreadcrumbList',
  itemListElement: list.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c[0], item: SITE + c[1] }))
});
const FAQ = { '@type': 'FAQPage', mainEntity: QA.map(q => ({ '@type': 'Question', name: q[0], acceptedAnswer: { '@type': 'Answer', text: q[1].join('\n') } })) };

/* ---------- pages ---------- */
const NAV_NAME = { about: '私たちについて', price: '料金', news: 'お知らせ', stores: '店舗情報', contact: 'お問い合わせ', policy: 'プライバシーポリシー' };
const pages = Object.keys(ROUTES).map(page => {
  const url = ROUTES[page];
  const graph = page === 'top' ? [WEBSITE, ORG].concat(STORES.map(storeLd))
    : [crumbs([['トップ', '/'], [NAV_NAME[page], url]])]
      .concat(page === 'stores' ? STORES.map(storeLd) : [])
      .concat(page === 'contact' ? [FAQ] : [])
      .concat(page === 'about' ? [ORG] : []);
  return { page, url, meta: PAGE_META[page], graph };
}).concat(STORES.map(s => ({
  page: 'store', url: '/tenpo/' + s.slug + '/', meta: storeMeta(s),
  graph: [storeLd(s), crumbs([['トップ', '/'], ['店舗情報', '/tenpo/'], [s.name, '/tenpo/' + s.slug + '/']])]
})));

const esc = t => t.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
function replaceOnce(html, from, to) {
  if (!html.includes(from)) throw new Error('build.js: not found in index.html: ' + from);
  return html.replace(from, () => to);
}
function render(p) {
  let h = src;
  const [title, desc] = p.meta, abs = SITE + p.url;
  h = h.replace(/<title>[^<]*<\/title>/, '<title>' + esc(title) + '</title>');
  h = h.replace(/(<meta name="description" content=")[^"]*/, '$1' + esc(desc));
  h = h.replace(/(<meta property="og:title" content=")[^"]*/, '$1' + esc(title));
  h = h.replace(/(<meta property="og:description" content=")[^"]*/, '$1' + esc(desc));
  h = h.replace(/(<link rel="canonical" href=")[^"]*/, '$1' + abs);
  h = h.replace(/(<meta property="og:url" content=")[^"]*/, '$1' + abs);
  if (!LIVE) h = h.replace(/(<meta name="robots" content=")[^"]*/, '$1noindex,nofollow');
  const ld = JSON.stringify({ '@context': 'https://schema.org', '@graph': p.graph }).replace(/</g, '\\u003c');
  h = replaceOnce(h, '</head>', '<script type="application/ld+json">' + ld + '</script>\n</head>');
  // show the right section in the HTML itself, before any script runs
  if (p.page !== 'top') {
    h = replaceOnce(h, 'id="page-top" data-name="top">', 'id="page-top" data-name="top" hidden>');
    h = replaceOnce(h, 'id="page-' + p.page + '" data-name="' + p.page + '" hidden>', 'id="page-' + p.page + '" data-name="' + p.page + '">');
  }
  return h;
}

/* ---------- write ---------- */
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
for (const dir of ['images', 'vendor']) fs.cpSync(path.join(__dirname, dir), path.join(OUT, dir), { recursive: true });
for (const p of pages) {
  const file = path.join(OUT, p.url, 'index.html');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, render(p));
}
fs.copyFileSync(path.join(__dirname, '404.html'), path.join(OUT, '404.html'));

const today = new Date().toISOString().slice(0, 10);
fs.writeFileSync(path.join(OUT, 'sitemap.xml'),
  '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
  pages.map(p => '  <url><loc>' + SITE + p.url + '</loc><lastmod>' + today + '</lastmod></url>').join('\n') +
  '\n</urlset>\n');
fs.writeFileSync(path.join(OUT, 'robots.txt'), 'User-agent: *\nAllow: /\n\nSitemap: ' + SITE + '/sitemap.xml\n');
fs.copyFileSync(path.join(__dirname, '_redirects'), path.join(OUT, '_redirects'));
if (!LIVE) fs.writeFileSync(path.join(OUT, '_headers'), '/*\n  X-Robots-Tag: noindex, nofollow\n');

console.log('built ' + pages.length + ' pages into dist/ (' + (LIVE ? 'indexable' : 'noindex: not on ' + SITE) + ')');
