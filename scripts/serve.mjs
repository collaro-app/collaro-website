/**
 * Local preview server — run with `npm run serve` (from the repo root), then
 * open http://localhost:8080. Zero dependencies.
 *
 * Serves `docs/` the way GitHub Pages does, so the preview matches production
 * (the pages use root-relative paths, so opening docs/*.html straight from the
 * file system does not work — use this):
 *   /                → docs/index.html
 *   /support/        → docs/support/index.html
 *   /support         → 301 to /support/ (a directory without its trailing slash)
 *   /support.he.html → docs/support.he.html (a file, e.g. an old-URL redirect stub)
 *   /foo             → docs/foo.html when that file exists (GitHub serves it, no redirect)
 *   /missing         → docs/404.html with a 404 status
 * Nothing is cached, so a `npm run build` shows up on the next reload.
 *
 *   node scripts/serve.mjs            # port 8080
 *   node scripts/serve.mjs --port 3000
 */
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const docs = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs');

const args = process.argv.slice(2);
const portFlag = args.indexOf('--port');
const port = Number(portFlag !== -1 ? args[portFlag + 1] : process.env.PORT) || 8080;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

const isFile = (file) => file.startsWith(docs) && existsSync(file) && statSync(file).isFile();

/**
 * Resolve a request path the way GitHub Pages does: `{ file }` to serve,
 * `{ redirect }` to the trailing-slash form of a directory, or null (404).
 * A file named like the path wins over a directory of the same name, and a
 * trailing slash only ever means a directory.
 */
function resolve(urlPath) {
  const pathname = decodeURIComponent(urlPath.split('?')[0]);
  const clean = normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  if (pathname.endsWith('/')) {
    const index = join(docs, clean, 'index.html');
    return isFile(index) ? { file: index } : null;
  }
  for (const file of [join(docs, clean), join(docs, `${clean}.html`)]) {
    if (isFile(file)) return { file };
  }
  if (isFile(join(docs, clean, 'index.html'))) return { redirect: `${pathname}/` };
  return null;
}

createServer((req, res) => {
  const url = req.url ?? '/';
  const found = resolve(url);
  if (found?.redirect) {
    const query = url.includes('?') ? url.slice(url.indexOf('?')) : '';
    res.writeHead(301, { Location: found.redirect + query });
    res.end();
    console.log(`301 ${url} → ${found.redirect}`);
    return;
  }
  const status = found ? 200 : 404;
  const target = found?.file ?? join(docs, '404.html');
  const body = existsSync(target) ? readFileSync(target) : Buffer.from('Not found');
  res.writeHead(status, {
    'Content-Type': TYPES[extname(target).toLowerCase()] ?? 'application/octet-stream',
    'Cache-Control': 'no-store',
  });
  res.end(body);
  console.log(`${status} ${url}`);
}).listen(port, () => {
  console.log(`Serving docs/ at http://localhost:${port} (Ctrl+C to stop)`);
});
