/**
 * Local preview server — run with `npm run serve` (from the repo root), then
 * open http://localhost:8080. Zero dependencies.
 *
 * Serves `docs/` the way GitHub Pages does, so the preview matches production:
 *   /            → docs/index.html
 *   /support     → docs/support.html   (extensionless URLs)
 *   /missing     → docs/404.html with a 404 status
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

/** Resolve a request path to a file under docs/, or null (GitHub Pages rules). */
function resolve(urlPath) {
  const clean = normalize(decodeURIComponent(urlPath.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  const candidates = [
    join(docs, clean, 'index.html'),
    join(docs, clean),
    join(docs, `${clean}.html`),
  ];
  for (const file of candidates) {
    if (file.startsWith(docs) && existsSync(file) && statSync(file).isFile()) return file;
  }
  return null;
}

createServer((req, res) => {
  const file = resolve(req.url ?? '/');
  const status = file ? 200 : 404;
  const target = file ?? join(docs, '404.html');
  const body = existsSync(target) ? readFileSync(target) : Buffer.from('Not found');
  res.writeHead(status, {
    'Content-Type': TYPES[extname(target).toLowerCase()] ?? 'application/octet-stream',
    'Cache-Control': 'no-store',
  });
  res.end(body);
  console.log(`${status} ${req.url}`);
}).listen(port, () => {
  console.log(`Serving docs/ at http://localhost:${port} (Ctrl+C to stop)`);
});
