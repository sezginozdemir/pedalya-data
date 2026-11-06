// HTTP katmani: yonlendirme, kullanim siniri, sikistirma, statik dosyalar ve hata yonetimi.
import http from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { gzip } from 'node:zlib';
import { HttpError, log } from './lib.mjs';

const gzipAsync = promisify(gzip);
const MAX_BODY = 8 * 1024;
const COMPRESS_FROM = 1024;
const RATE_EXEMPT = new Set(['/api/v1/health']);
const CACHE_CONTROL = { '/api/v1/regions': 'public, max-age=300' };
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.json': 'application/json',
};
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': [
    "default-src 'self'",
    "connect-src 'self' https://tiles.openfreemap.org",
    "img-src 'self' data: blob: https://tiles.openfreemap.org",
    "style-src 'self' 'unsafe-inline'",
    "worker-src 'self' blob:",
    "child-src 'self' blob:",
  ].join('; '),
};

function clientIp(req, trustProxy) {
  if (trustProxy === 'cloudflare' && req.headers['cf-connecting-ip']) return req.headers['cf-connecting-ip'];
  if (trustProxy === 'forwarded' && req.headers['x-forwarded-for']) {
    return req.headers['x-forwarded-for'].split(',').at(-1).trim(); // En sagdaki degeri kendi vekilimiz yazar
  }
  return req.socket.remoteAddress;
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new HttpError(413, 'Istek cok buyuk');
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (body && typeof body === 'object' && !Array.isArray(body)) return body;
  } catch { /* asagida reddedilir */ }
  throw new HttpError(400, 'Gecersiz JSON');
}

async function serveStatic(pathname, res, publicDir) {
  let rel;
  try {
    rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).slice(1);
  } catch {
    throw new HttpError(400, 'Gecersiz adres');
  }
  const file = path.resolve(publicDir, rel);
  if (!file.startsWith(publicDir + path.sep)) throw new HttpError(403, 'Yasak');
  let body;
  try {
    body = await readFile(file);
  } catch {
    throw new HttpError(404, 'Bulunamadi');
  }
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream',
    'Cache-Control': 'no-cache', // Eski app.js yeni index.html ile karisip sayfayi bozmasin
  });
  res.end(body);
}

// Gelistirme icin; canlida ayni dosyalar statik barindirmadan sunulur
async function servePack(pathname, res, packsDir) {
  const name = pathname.slice('/packs/'.length);
  const isManifest = name === 'manifest.json';
  if (!isManifest && !/^[a-z0-9-]+\.db$/.test(name)) throw new HttpError(404, 'Bulunamadi');
  const file = path.join(packsDir, name);
  let size;
  try {
    size = (await stat(file)).size;
  } catch {
    throw new HttpError(404, 'Bulunamadi');
  }
  res.writeHead(200, isManifest
    ? { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': size, 'Cache-Control': 'public, max-age=300' }
    : { 'Content-Type': 'application/vnd.sqlite3', 'Content-Length': size, 'Cache-Control': 'public, max-age=86400' });
  await pipeline(createReadStream(file), res);
}

async function sendJson(req, res, status, data, cacheControl) {
  let body = Buffer.from(JSON.stringify(data));
  const headers = {
    ...SECURITY_HEADERS,
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': cacheControl ?? 'no-store',
    Vary: 'Accept-Encoding',
  };
  if (body.length >= COMPRESS_FROM && /\bgzip\b/.test(req.headers['accept-encoding'] ?? '')) {
    body = await gzipAsync(body);
    headers['Content-Encoding'] = 'gzip';
  }
  res.writeHead(status, headers);
  res.end(body);
}

export function createApp({ routes, config }) {
  let rateWindow = new Map();
  const resetTimer = setInterval(() => { rateWindow = new Map(); }, 60000);
  resetTimer.unref();

  function checkRate(req, pathname) {
    if (RATE_EXEMPT.has(pathname)) return;
    const key = `${clientIp(req, config.trustProxy)}|${pathname}`;
    const used = (rateWindow.get(key) ?? 0) + 1;
    rateWindow.set(key, used);
    if (used > (config.rateLimits[pathname] ?? config.rateLimits.default)) {
      throw new HttpError(429, 'Cok fazla istek, biraz sonra tekrar dene');
    }
  }

  async function handle(req, res) {
    let url;
    try {
      url = new URL(req.url, 'http://localhost');
    } catch {
      throw new HttpError(400, 'Gecersiz adres');
    }
    const { pathname, searchParams } = url;
    const post = req.method === 'POST';
    if (!post && req.method !== 'GET') throw new HttpError(405, 'Desteklenmeyen yontem');
    if (!post && pathname.startsWith('/packs/')) {
      checkRate(req, '/packs');
      return servePack(pathname, res, config.packsDir);
    }
    const route = Object.hasOwn(routes[post ? 'post' : 'get'], pathname) ? routes[post ? 'post' : 'get'][pathname] : null;
    if (!route && (post || pathname.startsWith('/api/'))) throw new HttpError(404, 'Bulunamadi');
    if (!route) return serveStatic(pathname, res, config.publicDir);
    checkRate(req, pathname);
    const data = await route(post ? await readJson(req) : searchParams);
    return sendJson(req, res, post ? 201 : 200, data, CACHE_CONTROL[pathname]);
  }

  return http.createServer(async (req, res) => {
    const started = performance.now();
    const pathname = (req.url ?? '').split('?')[0];
    try {
      await handle(req, res);
    } catch (err) {
      const known = err instanceof HttpError;
      if (!known) log('unhandled_error', { path: pathname, message: err.message });
      if (!res.headersSent) {
        await sendJson(req, res, known ? err.status : 502, {
          error: known ? err.message : 'Dis servis yanit vermedi',
        }).catch(() => res.destroy());
      }
    }
    if ((pathname.startsWith('/api/') || pathname.startsWith('/packs/')) && pathname !== '/api/v1/health') {
      // Konum yazilmaz; yaricap sorun gidermek icin yeterli
      const radius = /[?&]radius=(\d+)/.exec(req.url ?? '')?.[1];
      log('request', { method: req.method, path: pathname, radius, status: res.statusCode, ms: Math.round(performance.now() - started) });
    }
  });
}
