/**
 * Cutover helper for the OLD legal site (legal.collaro.app, repo collaro.app-legal).
 *
 * GitHub Pages cannot issue server-side redirects, so the way to keep the old
 * legal URLs alive after the pages move to collaro.app is to replace each old
 * page with a tiny stub that redirects (meta refresh + JS + a canonical link
 * for crawlers). This script writes those stubs into the old repo's checkout.
 *
 * It is NOT run automatically. Run it only once the new site is live on
 * https://collaro.app and every migrated page has been verified there — then
 * commit and push the result in the legal repo:
 *
 *   node scripts/legal-redirects.mjs --out ../Collaro-legal
 *
 * Mapping (old → new): the file names are identical, so
 *   legal.collaro.app/terms-of-service(.html)   → collaro.app/terms-of-service
 *   legal.collaro.app/terms-of-service.he.html  → collaro.app/terms-of-service.he.html
 *   legal.collaro.app/                          → collaro.app/support
 * (the old root rendered the repo README as a support/legal landing page).
 *
 * Keep the old repo's GitHub Pages + CNAME enabled for as long as the redirects
 * should work; disabling Pages there kills them.
 */
import { existsSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SITE = 'https://collaro.app';

/** old file → new public path */
const REDIRECTS = {
  'index.html': '/support',
  'terms-of-service.html': '/terms-of-service',
  'terms-of-service.he.html': '/terms-of-service.he.html',
  'privacy-policy.html': '/privacy-policy',
  'privacy-policy.he.html': '/privacy-policy.he.html',
  'account-deletion.html': '/account-deletion',
  'account-deletion.he.html': '/account-deletion.he.html',
  'data-deletion.html': '/data-deletion',
  'data-deletion.he.html': '/data-deletion.he.html',
};

const stub = (target) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>Redirecting to collaro.app</title>
    <link rel="canonical" href="${target}" />
    <meta http-equiv="refresh" content="0; url=${target}" />
    <script>location.replace(${JSON.stringify(target)});</script>
  </head>
  <body>
    <p>This page has moved to <a href="${target}">${target}</a>.</p>
  </body>
</html>
`;

const args = process.argv.slice(2);
const outFlag = args.indexOf('--out');
if (outFlag === -1 || !args[outFlag + 1]) {
  console.error('\n✗ Pass the old legal repo checkout: node scripts/legal-redirects.mjs --out <path>\n');
  process.exit(1);
}
const outDir = resolve(args[outFlag + 1]);
if (!existsSync(join(outDir, 'CNAME'))) {
  console.error(`\n✗ ${outDir} does not look like the legal repo (no CNAME file).\n`);
  process.exit(1);
}

for (const [file, path] of Object.entries(REDIRECTS)) {
  writeFileSync(join(outDir, file), stub(SITE + path), 'utf8');
  console.log(`  ${file} → ${SITE}${path}`);
}
console.log(`\n✓ Wrote ${Object.keys(REDIRECTS).length} redirect stubs to ${outDir}. Review, then commit and push them there.`);
