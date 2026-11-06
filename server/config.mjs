// Tum ortam ayarlari burada. Ornekler icin .env.example dosyasina bak.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const env = process.env;
const { version } = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const dataDir = path.resolve(ROOT, env.PEDALYA_DATA_DIR ?? 'data');

export const config = {
  version,
  host: env.HOST ?? '127.0.0.1', // Varsayilan: sadece bu makine
  port: Number(env.PORT ?? 5173),
  trustProxy: env.TRUST_PROXY ?? 'none', // none | cloudflare | forwarded
  publicDir: path.join(ROOT, 'public'),
  dataDir,
  placesDb: path.join(dataDir, 'pedalya.db'),
  communityDb: path.join(dataDir, 'community.db'),
  cacheDir: path.join(dataDir, 'cache'),
  rawDir: path.join(dataDir, 'raw'),
  backupDir: path.join(dataDir, 'backups'),
  packsDir: path.join(dataDir, 'packs'),
  userAgent: env.USER_AGENT ?? `Pedalya/${version} (bicycle map)`,
  nominatimUrl: env.NOMINATIM_URL ?? 'https://nominatim.openstreetmap.org',
  // Herkese acik Nominatim en fazla 1 istek/sn ister; kendi sunucumuzda 0 yapilir
  nominatimDelayMs: Number(env.NOMINATIM_DELAY_MS ?? 1100),
  brouterUrl: env.BROUTER_URL ?? 'https://brouter.de',
  rateLimits: {
    '/api/v1/geocode': Number(env.RATE_GEOCODE ?? 10),
    '/api/v1/route': Number(env.RATE_ROUTE ?? 30),
    '/api/v1/reports': Number(env.RATE_REPORTS ?? 5),
    default: Number(env.RATE_DEFAULT ?? 120),
  },
};
