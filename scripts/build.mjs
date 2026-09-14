/**
 * Static site builder — run with `npm run build` (from the repo root).
 *
 * Renders `src/` into `docs/`, the folder GitHub Pages publishes. Zero
 * dependencies, on purpose: the whole site is plain HTML/CSS/JS, and this
 * script only does what a static site can't do by itself — share ONE page
 * chrome (`src/layout.html`) across every page, keep every string in one
 * per-language JSON file so the site can be localized without touching the
 * markup, and wrap the legal documents the app publishes into the same chrome.
 *
 *   src/layout.html                the shared chrome (head, header, footer)
 *   src/site.json                  site-wide config (URL, contact email, store links)
 *   src/strings/<lang>.json        every UI + marketing string, per language
 *   src/pages/<name>.html          page templates — rendered once per language in strings/
 *   src/legal/<name>.<lang>.html   long-form documents, one file per language
 *   src/icons/<name>.svg           inline icons, referenced as {{icon:<name>}}
 *   src/partials/<name>.html       reusable template snippets, referenced as {{><name>}}
 *   docs/assets/                   hand-managed static files (css, js, images) — not touched
 *
 * Every source page starts with a JSON front-matter comment:
 *
 *   <!--page
 *   { "title": "Support", "description": "…", "nav": "support" }
 *   -->
 *
 * Templating is deliberately tiny: `{{a.b.c}}` looks a value up in the merged
 * context (strings[lang] + site + page), `{{icon:name}}` inlines an SVG,
 * `{{#if a.b}}…{{/if}}` / `{{#unless a.b}}…{{/unless}}` include a block when the
 * value is truthy / falsy, and `{{#each a.list}}…{{this.x}}…{{/each}}` repeats a
 * block per item. An unknown placeholder FAILS the build — a typo or a missing
 * translation must never ship as literal braces.
 *
 * Output naming follows the URLs the legal site already had, so nothing moves:
 *   pages/index.html  + en → docs/index.html          (and he → docs/index.he.html)
 *   legal/terms-of-service.en.html → docs/terms-of-service.html
 *   legal/terms-of-service.he.html → docs/terms-of-service.he.html
 * GitHub Pages serves `/terms-of-service` from `terms-of-service.html`.
 *
 * Usage:
 *   node scripts/build.mjs           # write docs/*.html + docs/sitemap.xml
 *   node scripts/build.mjs --check   # verify docs/ is up to date (exit 1 + list if not)
 */
import { existsSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'src');
const out = join(root, 'docs');

const read = (p) => readFileSync(p, 'utf8');
const loadJson = (p) => JSON.parse(read(p));

const site = loadJson(join(src, 'site.json'));
const layout = read(join(src, 'layout.html'));

/** `{ en: {...}, he: {...} }` — one entry per strings file present. */
const strings = Object.fromEntries(
  readdirSync(join(src, 'strings'))
    .filter((f) => f.endsWith('.json'))
    .map((f) => [basename(f, '.json'), loadJson(join(src, 'strings', f))]),
);

const RTL_LANGS = new Set(['he']);
const OG_LOCALES = { en: 'en_US', he: 'he_IL' };
const DEFAULT_LANG = site.defaultLang;

// ---------------------------------------------------------------------------
// Front matter + templating
// ---------------------------------------------------------------------------

const FRONT_MATTER = /^\s*<!--page\s*([\s\S]*?)-->\s*/;

/** Split a source page into its JSON front matter and the body. */
function parsePage(file) {
  const text = read(file);
  const match = text.match(FRONT_MATTER);
  if (!match) fail(`${file}: missing the <!--page … --> front matter`);
  let meta;
  try {
    meta = JSON.parse(match[1]);
  } catch (error) {
    fail(`${file}: front matter is not valid JSON (${error.message})`);
  }
  return { meta, body: text.slice(match[0].length) };
}

const escapeHtml = (text) =>
  String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Dotted-path lookup (`a.b.c`) in the merged context. */
function lookup(context, path) {
  return path.split('.').reduce((value, key) => (value == null ? undefined : value[key]), context);
}

const iconCache = new Map();
function icon(name) {
  if (!iconCache.has(name)) {
    const file = join(src, 'icons', `${name}.svg`);
    if (!existsSync(file)) fail(`unknown icon {{icon:${name}}} (no ${file})`);
    // One line, decorative: every icon on the site sits next to visible text.
    iconCache.set(name, read(file).replace(/\s*\n\s*/g, ' ').trim().replace('<svg ', '<svg aria-hidden="true" focusable="false" '));
  }
  return iconCache.get(name);
}

// A loop body may hold conditionals (rendered per item, with `this` bound) but
// not another loop; a conditional body may not hold another block opener, so
// nested conditionals resolve innermost-first by re-running the replacement
// until nothing changes.
const EACH = /{{#each ([\w.]+)}}((?:(?!{{#each)[\s\S])*?){{\/each}}/g;
const BLOCK = /{{#(if|unless) ([\w.]+)}}((?:(?!{{#)[\s\S])*?){{\/\1}}/g;
const PLACEHOLDER = /{{(icon:)?([\w.-]+)}}/g;
// Anything still looking like a directive after rendering is a typo (an unclosed
// block, a misspelled opener, a spaced key) and must fail rather than ship.
const LEFTOVER = /{{[\s\S]{0,60}?(}}|$)/;

function replaceUntilStable(text, pattern, replacer) {
  let previous;
  do {
    previous = text;
    text = text.replace(pattern, replacer);
  } while (text !== previous);
  return text;
}

const PARTIAL = /{{>([\w-]+)}}/g;

function partial(name) {
  const file = join(src, 'partials', `${name}.html`);
  if (!existsSync(file)) fail(`unknown partial {{>${name}}} (no ${file})`);
  return read(file);
}

/** Resolve partials, loops, conditionals (innermost first), then placeholders. */
function render(template, context, where) {
  // A partial is a reusable template snippet, rendered in the same context.
  let text = template.replace(PARTIAL, (_, name) => render(partial(name), context, `partials/${name}.html`));

  // A loop body is rendered per item with `this` bound, so it comes out fully
  // resolved and the later passes leave it alone.
  text = replaceUntilStable(text, EACH, (_, path, inner) => {
    const list = lookup(context, path);
    if (!Array.isArray(list)) fail(`${where}: {{#each ${path}}} is not a list`);
    return list.map((item) => render(inner, { ...context, this: item }, where)).join('');
  });

  text = replaceUntilStable(text, BLOCK, (_, kind, path, inner) => {
    const truthy = Boolean(lookup(context, path));
    return truthy === (kind === 'if') ? inner : '';
  });

  return text.replace(PLACEHOLDER, (_, isIcon, key) => {
    if (isIcon) return icon(key);
    const value = lookup(context, key);
    if (value === undefined || value === null) fail(`${where}: unknown placeholder {{${key}}}`);
    // The page body is already rendered (or is verbatim prose) — never a template
    // again. Any other string may itself embed a placeholder.
    if (key === 'content') return value;
    return String(value).includes('{{') ? render(String(value), context, where) : String(value);
  });
}

/** The final guard: a rendered page must contain no directive-looking text at all. */
function assertFullyRendered(html, where) {
  const leftover = html.match(LEFTOVER);
  if (leftover) fail(`${where}: unresolved template text ${JSON.stringify(leftover[0])}`);
}

// ---------------------------------------------------------------------------
// The page list — templates × languages, plus the per-language documents
// ---------------------------------------------------------------------------

/** docs/ filename for a page name + language (the default language has no suffix). */
const outputName = (name, lang) => (lang === DEFAULT_LANG ? `${name}.html` : `${name}.${lang}.html`);

/**
 * Public URL of an output file: `/` for the home page, extensionless for the
 * default language (GitHub Pages resolves `/support` to `support.html`), and the
 * full file name for the other languages — the URLs the legal site already had.
 */
function publicPath(fileName) {
  if (fileName === 'index.html') return '/';
  if (/\.[a-z]{2}\.html$/.test(fileName)) return `/${fileName}`;
  return `/${fileName.replace(/\.html$/, '')}`;
}

function collectPages() {
  const pages = [];

  for (const file of readdirSync(join(src, 'pages')).filter((f) => f.endsWith('.html'))) {
    const name = basename(file, '.html');
    const { meta, body } = parsePage(join(src, 'pages', file));
    if (!meta.strings) fail(`pages/${file}: front matter needs "strings": the namespace the page reads`);
    // A template is published in every language whose strings file carries
    // its namespace — translating `home` into he.json is all it takes to add
    // the Hebrew home page.
    for (const lang of Object.keys(strings).filter((l) => strings[l][meta.strings])) {
      pages.push({ name, lang, meta, body, kind: 'page', source: `pages/${file}`, templated: true });
    }
  }

  const legalDir = join(src, 'legal');
  for (const file of readdirSync(legalDir).filter((f) => f.endsWith('.html'))) {
    const match = file.match(/^(.+)\.([a-z]{2})\.html$/);
    if (!match) fail(`legal/${file}: documents are named <name>.<lang>.html`);
    const [, name, lang] = match;
    if (!strings[lang]) fail(`legal/${file}: no src/strings/${lang}.json for the page chrome`);
    const { meta, body } = parsePage(join(legalDir, file));
    pages.push({ name, lang, meta, body, kind: 'document', source: `legal/${file}`, templated: false });
  }

  return pages;
}

/** The language switch + hreflang links: every other language the same page exists in. */
function alternates(page, pages) {
  return pages
    .filter((other) => other.name === page.name && other.lang !== page.lang)
    .map((other) => ({
      lang: other.lang,
      href: outputName(other.name, other.lang),
      label: strings[other.lang].chrome.languageName,
    }));
}

function renderPage(page, pages) {
  const fileName = outputName(page.name, page.lang);
  const path = publicPath(fileName);
  const alternate = alternates(page, pages);
  const defaultLangHref = page.lang === DEFAULT_LANG ? fileName : alternate.find((a) => a.lang === DEFAULT_LANG)?.href;
  // Cross-page links from this page: the same-language copy of the target when
  // one exists (a Hebrew page links to the Hebrew Terms), else the default one.
  const href = Object.fromEntries(
    [...new Set(pages.map((p) => p.name))].map((name) => [
      name,
      outputName(name, pages.some((p) => p.name === name && p.lang === page.lang) ? page.lang : DEFAULT_LANG),
    ]),
  );

  // Title/description come from the front matter (possibly via string keys):
  // resolve them first, then escape for the attribute/text contexts they land in.
  const base = { ...strings[page.lang], site, page: { lang: page.lang } };
  const title = render(page.meta.title, base, page.source);
  const description = render(page.meta.description, base, page.source);
  const fullTitle = page.name === 'index' ? title : `${title} · ${site.name}`;

  const context = {
    ...strings[page.lang],
    site,
    page: {
      ...page.meta,
      title: escapeHtml(title),
      description: escapeHtml(description),
      // JSON string literals (quotes included) for the JSON-LD block.
      descriptionJson: JSON.stringify(description),
      fullTitleJson: JSON.stringify(fullTitle),
      lang: page.lang,
      dir: RTL_LANGS.has(page.lang) ? 'rtl' : 'ltr',
      ogLocale: OG_LOCALES[page.lang] ?? page.lang,
      kind: page.kind,
      isDocument: page.kind === 'document',
      isHome: page.name === 'index',
      path,
      url: site.url + path,
      // The home page is the one place the site name leads.
      fullTitle: escapeHtml(fullTitle),
      nav: Object.fromEntries((page.meta.nav ? [page.meta.nav] : []).map((n) => [n, true])),
      href,
      alternate,
      hasAlternate: alternate.length > 0,
      // hreflang: this page, each alternate, and x-default → the default-language copy.
      hreflang: [
        { lang: page.lang, href: site.url + path },
        ...alternate.map((a) => ({ lang: a.lang, href: site.url + publicPath(a.href) })),
        ...(defaultLangHref ? [{ lang: 'x-default', href: site.url + publicPath(defaultLangHref) }] : []),
      ],
      appStoreReady: Boolean(site.appStoreUrl),
      playStoreReady: Boolean(site.playStoreUrl),
    },
  };

  // Templates use the strings; documents are prose and are inserted verbatim.
  const content = page.templated ? render(page.body, context, page.source) : page.body;
  let html = render(layout, { ...context, content }, `layout.html (for ${page.source})`);
  assertFullyRendered(html, page.source);
  // GitHub Pages serves 404.html for ANY missing path, including nested ones,
  // so this one page must reference its assets and links from the site root.
  if (fileName === '404.html') html = html.replace(/(href|src)="(?!(?:[a-z]+:|#|\/))/g, '$1="/');
  return { fileName, path, html };
}

function renderSitemap(rendered) {
  const urls = rendered.map(({ path }) => `  <url><loc>${site.url}${path}</loc></url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function fail(message) {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

const check = process.argv.includes('--check');

const pages = collectPages();
const rendered = pages.map((page) => renderPage(page, pages));
const files = [
  ...rendered.map(({ fileName, html }) => ({ fileName, text: html })),
  { fileName: 'sitemap.xml', text: renderSitemap(rendered.filter(({ fileName }) => fileName !== '404.html')) },
];

const duplicates = files.map((f) => f.fileName).filter((name, i, all) => all.indexOf(name) !== i);
if (duplicates.length) fail(`two sources render to the same file: ${[...new Set(duplicates)].join(', ')}`);

// Every *.html (and the sitemap) at the root of docs/ is generated, so one that
// no source produces any more is an orphan: a renamed page would otherwise stay
// published with stale content.
const generated = new Set(files.map((f) => f.fileName));
const orphans = readdirSync(out).filter((f) => (f.endsWith('.html') || f === 'sitemap.xml') && !generated.has(f));

if (!site.appStoreUrl) console.warn('! site.appStoreUrl is not set — rendering the App Store button as "coming soon"');
if (!site.playStoreUrl) console.warn('! site.playStoreUrl is not set — rendering the Google Play button as "coming soon"');

if (check) {
  const stale = files.filter(({ fileName, text }) => {
    const target = join(out, fileName);
    return !existsSync(target) || read(target) !== text;
  });
  if (stale.length || orphans.length) {
    fail(
      'docs/ is out of date:\n' +
        [...stale.map(({ fileName }) => `  - docs/${fileName}`), ...orphans.map((f) => `  - docs/${f} (orphan)`)].join('\n') +
        '\nRun `npm run build` and commit the result.',
    );
  }
  console.log(`✓ docs/ is up to date (${files.length} files)`);
} else {
  for (const { fileName, text } of files) writeFileSync(join(out, fileName), text, 'utf8');
  for (const f of orphans) unlinkSync(join(out, f));
  console.log(`✓ Wrote ${files.length} files to docs/`);
  for (const { fileName } of files) console.log(`  ${fileName}`);
  for (const f of orphans) console.log(`  removed orphan ${f}`);
}
